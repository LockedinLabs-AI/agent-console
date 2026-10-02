import { programOnPath } from '../programs.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { codexCapacity } from './capacity.js';

export function nativeEnvironment(profile, env = process.env) {
  // A shared API-key override defeats the promise of selecting a signed-in
  // profile. Refuse it without reading or displaying the credential value.
  const overrides = profile.provider === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']
    : ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
  if (overrides.some(k => Boolean(env[k]))) throw new Error('An API or authentication override is set. Use a native subscription profile without those overrides.');
  return { ...env, [profile.provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: profile.directory };
}

export function nativeProgram(provider, env = process.env, { platform = process.platform, home = os.homedir(), cwd = process.cwd(), exists, real } = {}) {
  const name = provider === 'codex' ? 'codex' : 'claude';
  if (platform === 'win32') {
    // Native clients commonly install beneath the user's home. Accept those
    // explicit PATH entries when the quota reader runs at home. Interactive
    // launches retain their project cwd: exclude that entire tree and aliases.
    const exe = programOnPath(name, { env, cwd, platform, exists, real,
      excludeDescendants: path.win32.relative(home, cwd) !== '' });
    if (exe) return exe;
  } else {
    for (const dir of (env.PATH || '').split(path.delimiter)) {
      if (!path.isAbsolute(dir)) continue;
      const exe = path.join(dir, name);
      try { fs.accessSync(exe, fs.constants.X_OK); if (fs.statSync(exe).isFile()) return exe; } catch { /* next */ }
    }
  }
  throw new Error(`Install the native ${name} executable on PATH first.`);
}

/** Read only the documented app-server account method. No thread or turn is
 * started, no OAuth file is opened, and all unneeded response fields are
 * discarded before storage. stdout, stderr and error text never reach the UI. */
export function readCodexCapacity(profile, { spawnProcess = spawn, timeoutMs = 15_000,
  executable, env = process.env, now = Date.now } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, done = false, buffer = '', bytes = 0;
    const decoder = new StringDecoder('utf8');
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (child) {
        child.stdin.end(); child.kill();
        const reaper = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
        reaper.unref();
      }
      if (error) reject(error); else resolve(value);
    };
    const fail = () => finish(new Error('Codex capacity is unavailable. Check native sign-in and CLI version, then refresh.'));
    try {
      child = spawnProcess(executable || nativeProgram('codex', env, { cwd: os.homedir() }), ['app-server'], {
        env: nativeEnvironment(profile, env), cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (e) { finish(e); return; }
    const send = value => { if (!done) child.stdin.write(JSON.stringify(value) + '\n'); };
    timer = setTimeout(fail, timeoutMs);
    child.once('error', fail);
    child.once('exit', () => { if (!done) fail(); });
    child.stdin.on('error', fail);
    child.stderr.on('data', () => {}); // Drain, never log provider diagnostics.
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { fail(); return; }
      buffer += decoder.write(chunk);
      let end;
      while (!done && (end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value;
        try { value = JSON.parse(line); } catch { fail(); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(); return; }
        if (value.id === 1) {
          if (value.error || !value.result) { fail(); return; }
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (value.id === 2) {
          if (value.error || !value.result) { fail(); return; }
          finish(null, codexCapacity(value.result, now()));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent_console_capacity', title: 'Agent Console', version: '0.4.3' } } });
  });
}

export function capacityService(store, { read = readCodexCapacity, now = Date.now } = {}) {
  const pending = new Map(), last = new Map();
  async function refresh(id) {
    const p = store.get(id);
    if (p.provider !== 'codex') throw new Error('Claude capacity updates through its status-line connection after a native response.');
    if (pending.has(id)) return pending.get(id);
    if (now() - (last.get(id) || 0) < 30_000) return store.view();
    if (pending.size >= 2) throw new Error('Two profiles are refreshing. Try again shortly.');
    last.set(id, now());
    const task = (async () => {
      try { store.snapshot(id, await read(p)); }
      catch { store.snapshot(id, { source: 'Codex app-server', observedAt: now(), windows: [],
        error: 'Native quota refresh failed. Check Codex sign-in and CLI version.' }); }
      finally { pending.delete(id); }
      return store.view();
    })();
    pending.set(id, task);
    return task;
  }
  return { refresh };
}
