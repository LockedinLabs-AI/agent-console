import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHmac } from 'node:crypto';
import { parseLine } from '../lib/collector/parsers.js';
import { priceRecord } from '../lib/collector/pricing.js';
import { transcriptRoots } from '../lib/collector/collector.js';

const prices = JSON.parse(fs.readFileSync(new URL('../lib/collector/prices.json', import.meta.url), 'utf8'));
const hashIdentity = (kind, value) => createHmac('sha256', 'synthetic-local-test-salt').update(`${kind}\0${value}`).digest('hex');
const recordId = (tool, sessionId, messageId) => createHmac('sha256', 'synthetic-org-salt').update(`${tool}|${sessionId}|${messageId}`).digest('hex');
/* Real Pi transcript shapes and numbers with synthetic ids, paths and empty
   content: nothing in the fixture names a person, a login or a home folder. */
const FIXTURE = fs.readFileSync(new URL('./fixtures/pi-session.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean);

function parsed(labels = []) {
  const context = {
    recordId, reportingDevice: 'synthetic-device-pi', sourceId: 'opaque-synthetic-source',
    hashIdentity, projectHash: hashIdentity('project', '/synthetic/fallback'),
    onLocalLabel: (label) => labels.push(label),
  };
  const records = [];
  let state;
  for (const line of FIXTURE) {
    const result = parseLine('pi', line, context, state);
    state = result.state;
    records.push(...result.records);
  }
  return { records, state, context };
}

test('Pi usage: input is the fresh class as recorded and the four classes reproduce its own total', () => {
  const { records } = parsed();
  assert.equal(records.length, 3);
  const written = FIXTURE.map(JSON.parse).filter((line) => line.message?.usage).map((line) => line.message.usage);
  for (const [index, row] of records.entries()) {
    const usage = written[index];
    assert.deepEqual([row.fresh, row.output, row.cacheRead, row.cacheWrite],
      [usage.input, usage.output, usage.cacheRead, usage.cacheWrite]);
    // Pi counts input exclusive of the cache classes: its own totalTokens is
    // the sum of all four, so nothing here is subtracted or double counted.
    assert.equal(row.fresh + row.output + row.cacheRead + row.cacheWrite, usage.totalTokens);
    // Reasoning is a subset of output and is never added to anything.
    assert.ok(usage.reasoning <= usage.output);
    assert.equal(row.tool, 'pi');
    assert.equal(row.ttl, 'unknown');
    assert.equal(row.isSubagent, false);
    assert.equal(row.parentSessionHash, null);
  }
});

test('the bundled rates reproduce the cost Pi recorded for every model in the fixture', () => {
  const { records } = parsed();
  const written = FIXTURE.map(JSON.parse).filter((line) => line.message?.usage).map((line) => line.message.usage);
  for (const [index, row] of records.entries()) {
    const estimate = priceRecord(row, prices, { measurement: false });
    assert.equal(estimate.status, 'estimated', row.model);
    // The derived gpt-6.1-sol row and the published rows of the other two
    // models are checked the same way: against the agent's own recorded cost.
    assert.ok(Math.abs(estimate.usd - written[index].cost.total) < 1e-9,
      `${row.model}: ${estimate.usd} vs ${written[index].cost.total}`);
  }
});

test('Pi identity: the session line binds the session and its folder, and a replayed message counts once', () => {
  const labels = [];
  const { records, state, context } = parsed(labels);
  assert.deepEqual(labels.map((label) => label.cwd), ['/synthetic/workspace']);
  assert.equal(records[0].sessionHash, hashIdentity('session', 'pi:synthetic-pi-session'));
  assert.equal(records[0].projectHash, hashIdentity('project', '/synthetic/workspace'));
  assert.equal(records[0].id, recordId('pi', 'synthetic-pi-session', 'message:synthetic-a'));
  assert.equal(records[0].at, '2026-10-03T02:00:00.000Z');
  // Reading the same lines again on the kept state adds nothing: Pi appends a
  // finished message, so a second sighting is a replay and not growth.
  const again = FIXTURE.flatMap((line) => parseLine('pi', line, context, state).records);
  assert.deepEqual(again, []);
});

test('a model change names the model only until a message names the one that served it', () => {
  const { records } = parsed();
  assert.deepEqual(records.map((row) => row.model), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-terra']);
  const context = { recordId, reportingDevice: 'synthetic-device-pi', hashIdentity,
    projectHash: hashIdentity('project', '/synthetic/fallback') };
  const started = parseLine('pi', FIXTURE[0], context);
  const changed = parseLine('pi', FIXTURE[1], context, started.state);
  assert.equal(changed.state.model, 'gpt-6.1-sol');
  assert.deepEqual(changed.records, []);
  // A line that carries no usage, and a user message, are not records.
  assert.deepEqual(parseLine('pi', FIXTURE[2], context, changed.state).records, []);
});

test('the Pi transcript root is read, is optional, and --pi-root replaces it', () => {
  const home = path.join(os.tmpdir(), 'synthetic-pi-home');
  const roots = transcriptRoots({ home, env: {} });
  const own = roots.filter((root) => root.tool === 'pi');
  assert.deepEqual(own, [{ tool: 'pi', directory: path.resolve(home, '.pi/agent/sessions'), optional: true, kind: 'default' }]);
  const named = transcriptRoots({ home, env: { PI_HOME: '~/other-pi' } }).filter((root) => root.tool === 'pi');
  assert.deepEqual(named.map((root) => [root.directory, root.optional]),
    [[path.resolve(home, 'other-pi/agent/sessions'), false], [path.resolve(home, '.pi/agent/sessions'), true]]);
  const replaced = transcriptRoots({ home, env: {}, piRoot: '/synthetic/elsewhere' }).filter((root) => root.tool === 'pi');
  assert.deepEqual(replaced.map((root) => root.directory), [path.resolve('/synthetic/elsewhere')]);
});
