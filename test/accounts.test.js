import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { FRESH_MS, claudeCapacity, codexCapacity, capacityView, recommend, storedCapacity } from '../lib/accounts/capacity.js';
import vm from 'node:vm';
import { accountStore } from '../lib/accounts/store.js';
import { readCodexCapacity, nativeEnvironment, nativeProgram, capacityService } from '../lib/accounts/native.js';
import { accountsMain } from '../lib/accounts/cli.js';

const NOW = Date.UTC(2026, 0, 1);
const profile = { id: 'personal', label: 'Personal', provider: 'codex', enabled: true };
const at = minutes => Math.floor((NOW + minutes * 60_000) / 1000);
const codex = (used = 40, reset = 1000) => ({ rateLimits: {
  primary: { usedPercent: used, resetsAt: at(60), windowDurationMins: 300 },
  secondary: { usedPercent: 75, resetsAt: at(reset), windowDurationMins: 10080 },
} });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-accounts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const native = path.join(dir, 'native'); fs.mkdirSync(native);
  const store = accountStore(path.join(dir, 'state'), { now: () => NOW });
  store.add({ ...profile, directory: native });
  return { dir, native, store };
}

test('native quota normalizers preserve zero, reject missing fields, and never persist extra source data', () => {
  const source = { ...codex(0), email: 'invented@example.test', access_token: 'SYNTHETIC_DO_NOT_STORE', transcript: 'synthetic prompt' };
  const s = codexCapacity(source, NOW);
  assert.equal(s.windows[0].remainingPercent, 100);
  assert.equal(s.windows[1].remainingPercent, 25);
  assert.doesNotMatch(JSON.stringify(s), /example|SYNTHETIC|prompt|email|token/);
  const c = claudeCapacity({ rate_limits: { five_hour: { used_percentage: 0, resets_at: at(10) } }, cwd: '/synthetic/private' }, NOW);
  assert.equal(c.windows[0].remainingPercent, 100);
  assert.equal(c.windows[1].remainingPercent, null);
  assert.equal(capacityView({ ...profile, provider: 'claude-code' }, c, NOW).state, 'incomplete');
  for (const value of [null, '30', NaN, Infinity, -1, 101]) assert.equal(codexCapacity(codex(value), NOW).windows[0].remainingPercent, null);
});

test('named rate-limit buckets replace the legacy mirror and every bucket constrains selection', () => {
  const s = codexCapacity({ ...codex(), rateLimitsByLimitId: { codex: codex().rateLimits, research: codex(100).rateLimits } }, NOW);
  assert.equal(s.windows.length, 4);
  const p = capacityView(profile, s, NOW);
  assert.equal(p.state, 'exhausted'); assert.equal(recommend([p], 'codex'), null);
  assert.equal(codexCapacity({}, NOW).windows[0].remainingPercent, null);
});

test('freshness, exhaustion, passed resets, failed sources and pausing fail closed', () => {
  const s = codexCapacity(codex(), NOW);
  assert.equal(capacityView(profile, s, NOW).state, 'ready');
  assert.equal(capacityView(profile, s, NOW + FRESH_MS + 1).state, 'stale');
  assert.equal(capacityView(profile, { ...s, observedAt: NOW + 121000 }, NOW).state, 'stale');
  assert.equal(capacityView(profile, codexCapacity(codex(100), NOW), NOW).state, 'exhausted');
  assert.equal(capacityView(profile, codexCapacity(codex(40, -1), NOW), NOW).state, 'awaiting-reset');
  assert.equal(capacityView(profile, { ...s, error: 'Unavailable' }, NOW).state, 'unavailable');
  assert.equal(capacityView({ ...profile, enabled: false }, s, NOW).state, 'paused');
});

test('selection uses the long-window reset within one provider, not percentage sums or short resets', () => {
  const later = capacityView(profile, codexCapacity(codex(5, 5000), NOW), NOW);
  const earlier = capacityView({ ...profile, id: 'work' }, codexCapacity(codex(90, 1500), NOW), NOW);
  const other = { ...earlier, id: 'claude', provider: 'claude-code', priorityResetAt: NOW + 1 };
  assert.equal(recommend([later, other, earlier], 'codex').profileId, 'work');
  assert.equal(recommend([later, other, earlier], 'claude-code').profileId, 'claude');
});

test('profile persistence rejects traversal, duplicate homes and labels with markup', t => {
  const { store, native, dir } = fixture(t);
  for (const id of ['../escape', 'a/b', 'UPPER', '__proto__']) assert.throws(() => store.add({ ...profile, id, directory: native }));
  assert.throws(() => store.add({ ...profile, id: 'second', directory: native }), /already registered/);
  assert.throws(() => store.add({ ...profile, id: 'second', label: '<script>', directory: native }), /label/);
  assert.throws(() => store.add({ ...profile, id: 'second', directory: '.' }), /full path/);
  store.snapshot(profile.id, codexCapacity(codex(), NOW));
  const view = store.view();
  assert.equal(view.profiles[0].state, 'ready');
  assert.doesNotMatch(JSON.stringify(view), /"directory"|state\//);
  assert.equal(JSON.stringify(view).includes(native), false);
  store.enable(profile.id, false); assert.equal(store.view().recommendations.length, 0);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'state', 'accounts', 'personal.json')).mode & 0o777, 0o600);
});

test('status-line capture saves only quota metadata and preserves nulls', async t => {
  const { dir, native, store } = fixture(t);
  store.add({ ...profile, id: 'claude', provider: 'claude-code', directory: native });
  let output = '';
  const stdout = new Writable({ write(chunk, encoding, done) { output += chunk.toString(); done(); } });
  await accountsMain(['capture', '--id', 'claude', '--state-dir', path.join(dir, 'state')], {
    stdin: Readable.from([JSON.stringify({ rate_limits: { five_hour: { used_percentage: 32, resets_at: at(50) },
      seven_day: { used_percentage: 17, resets_at: at(500) } }, api_key: 'SYNTHETIC_SECRET', session_id: 'private-session', cwd: '/synthetic/private' })]), stdout,
  });
  assert.match(output, /68% left/);
  const saved = fs.readFileSync(path.join(dir, 'state', 'accounts', 'claude.quota.json'), 'utf8');
  assert.doesNotMatch(saved, /SECRET|private|session_id|cwd/);
});

test('damaged or oversized quota files remain unavailable rather than preserving old capacity', t => {
  const { dir, store } = fixture(t);
  const file = path.join(dir, 'state', 'accounts', 'personal.quota.json');
  store.snapshot(profile.id, codexCapacity(codex(), NOW));
  fs.writeFileSync(file, 'x'.repeat(64 * 1024 + 1));
  assert.equal(store.view().profiles[0].state, 'unavailable');
  assert.deepEqual(store.view().recommendations, []);
  fs.writeFileSync(file, '{');
  assert.equal(store.view().profiles[0].state, 'unavailable');
});

test('native environments isolate client homes and refuse auth overrides without leaking values', () => {
  const p = { ...profile, directory: '/synthetic/native' };
  assert.equal(nativeEnvironment(p, {}).CODEX_HOME, p.directory);
  assert.throws(() => nativeEnvironment(p, { OPENAI_API_KEY: 'SYNTHETIC_SECRET' }), e => !e.message.includes('SECRET') && /override/.test(e.message));
  assert.throws(() => nativeEnvironment({ ...p, provider: 'claude-code' }, { CLAUDE_CODE_OAUTH_TOKEN: 'SYNTHETIC_SECRET' }), /override/);
});

test('Windows native lookup accepts explicit home installs but refuses implicit or aliased current-directory programs', () => {
  const home = 'C:\\SyntheticHome';
  const bin = home + '\\.local\\bin';
  const files = new Set([home + '\\codex.exe', bin + '\\codex.exe']);
  const options = { platform: 'win32', home, exists: file => files.has(file), real: file => file };
  assert.equal(nativeProgram('codex', { Path: `.;${home};${bin}` }, options), bin + '\\codex.exe');
  assert.throws(() => nativeProgram('codex', { Path: `.;.local\\bin;${home}` }, options), /Install/);
  assert.throws(() => nativeProgram('codex', { Path: 'C:\\Alias' }, { ...options,
    exists: () => true, real: file => file.replace('C:\\Alias', home) }), /Install/);
});

function fakeProcess(answer) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  child.sent = [];
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const msg = JSON.parse(chunk.toString()); child.sent.push(msg);
    queueMicrotask(() => answer(msg, child)); done();
  } });
  return child;
}

test('Codex adapter initializes, requests only limits, bounds output, and terminates its child', async () => {
  const child = fakeProcess((m, c) => {
    if (m.id === 1) c.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
    if (m.id === 2) c.stdout.write(JSON.stringify({ id: 2, result: codex() }) + '\n');
  });
  const s = await readCodexCapacity({ ...profile, directory: '/synthetic/native' }, { executable: 'synthetic', env: {}, now: () => NOW,
    spawnProcess: (exe, args, options) => { assert.deepEqual(args, ['app-server']); assert.equal(options.env.CODEX_HOME, '/synthetic/native'); return child; } });
  assert.equal(s.windows[0].remainingPercent, 60);
  assert.deepEqual(child.sent.map(m => m.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(child.killed, true);
  const noisy = fakeProcess((m, c) => { if (m.id === 1) c.stdout.write('x'.repeat(1024 * 1024 + 1)); });
  await assert.rejects(readCodexCapacity(profile, { executable: 'synthetic', env: {}, spawnProcess: () => noisy }), /unavailable/);
  const stalled = fakeProcess(() => {});
  await assert.rejects(readCodexCapacity(profile, { executable: 'synthetic', env: {}, spawnProcess: () => stalled, timeoutMs: 5 }), /unavailable/);
  for (const invalid of [null, [], 12, 'invalid']) {
    const malformed = fakeProcess((m, c) => { if (m.id === 1) c.stdout.write(JSON.stringify(invalid) + '\n'); });
    await assert.rejects(readCodexCapacity(profile, { executable: 'synthetic', env: {}, spawnProcess: () => malformed }), /unavailable/);
  }
});

test('concurrent refreshes share one operation; errors make cached capacity ineligible', async t => {
  const { store } = fixture(t); let calls = 0, done;
  const service = capacityService(store, { now: () => NOW, read: async () => { calls++; await new Promise(r => { done = r; }); return codexCapacity(codex(), NOW); } });
  const a = service.refresh(profile.id), b = service.refresh(profile.id); done();
  await Promise.all([a, b]); assert.equal(calls, 1);
  await service.refresh(profile.id); assert.equal(calls, 1);
  const failed = capacityService(store, { now: () => NOW + 31000, read: async () => { throw new Error('SYNTHETIC_SECRET'); } });
  const out = await failed.refresh(profile.id);
  assert.equal(out.profiles[0].state, 'unavailable'); assert.equal(out.recommendations.length, 0);
  assert.doesNotMatch(JSON.stringify(out), /SYNTHETIC_SECRET/);
});

test('storage does not trust supplied remaining percentages or arbitrary error text', () => {
  const s = codexCapacity(codex(100), NOW);
  s.windows[0].remainingPercent = 99;
  s.access_token = 'SYNTHETIC_SECRET';
  assert.equal(storedCapacity(s).windows[0].remainingPercent, 0);
  assert.doesNotMatch(JSON.stringify(storedCapacity({ ...s, error: 'SYNTHETIC_SECRET' })), /SYNTHETIC/);
  assert.equal(capacityView(profile, storedCapacity({ ...s, windows: [null] }), NOW).state, 'incomplete');
});

test('a quota response completing after sign-out is discarded', async () => {
  const source = fs.readFileSync(new URL('../public/accounts.js', import.meta.url), 'utf8');
  const api = source.slice(source.indexOf('  async function api('), source.indexOf('  async function load('));
  let resolveJson;
  const context = vm.createContext({ sessionClosed: false, AbortSignal, fetch: async () => ({ ok: true,
    json: () => new Promise(resolve => { resolveJson = resolve; }) }) });
  const request = vm.runInContext(api + '\napi("/api/accounts")', context);
  await new Promise(resolve => setImmediate(resolve));
  context.sessionClosed = true;
  resolveJson({ profiles: [{ label: 'Private alias' }] });
  await assert.rejects(request, /Signed out/);
});

test('an expired session clears account details as soon as its response arrives', async () => {
  const source = fs.readFileSync(new URL('../public/accounts.js', import.meta.url), 'utf8');
  const api = source.slice(source.indexOf('  async function api('), source.indexOf('  async function load('));
  let cleared = false;
  const context = vm.createContext({ sessionClosed: false, AbortSignal, clear: () => { cleared = true; },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({ reason: 'Sign in required.' }) }) });
  await assert.rejects(vm.runInContext(api + '\napi("/api/accounts")', context), /Sign in required/);
  assert.equal(cleared, true);
});

test('a failed quota poll removes previously ready cards and recommendations', async () => {
  const source = fs.readFileSync(new URL('../public/accounts.js', import.meta.url), 'utf8');
  const loader = source.slice(source.indexOf('  function unavailable('), source.indexOf('  function paint('));
  const nodes = Object.fromEntries(['accountOverview', 'accountProfiles', 'accountStatus', 'view-accounts'].map(id =>
    [id, { hidden: false, innerHTML: 'Ready profile and recommendation', replaceChildren() { this.innerHTML = ''; } }]));
  const context = vm.createContext({ data: { profiles: [{ state: 'ready' }] }, loading: false, sessionClosed: false,
    document: { hidden: false }, $: id => nodes[id], api: async () => { throw new Error('Quota request failed.'); } });
  await vm.runInContext(loader + '\nload()', context);
  assert.equal(context.data, null);
  assert.equal(context.loading, false);
  assert.equal(nodes.accountOverview.innerHTML, '');
  assert.doesNotMatch(nodes.accountProfiles.innerHTML, /Ready profile/);
  assert.match(nodes.accountProfiles.innerHTML, /unavailable/);
  assert.equal(nodes.accountStatus.textContent, 'Quota request failed.');
});
