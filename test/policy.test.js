import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, parsePolicyDocument, parsePolicy } from '../lib/analysis/index.js';

test('YAML subset and JSON describe the same versioned policy; org wins per field', () => {
  const yaml = `version: 1
routing:
  roles:
    search:
      model: haiku
gates:
  force_push: block
model_allowlist:
  - haiku
  - sonnet
  - opus`;
  assert.deepEqual(parsePolicy(yaml), parsePolicy(JSON.stringify(parsePolicyDocument(yaml))));
  const merged = parsePolicy(yaml, 'version: 1\ngates:\n  force_push: ask\n  credential_read: block');
  assert.equal(merged.gates.force_push, 'ask');
  assert.equal(merged.gates.credential_read, 'block');
  assert.equal(merged.gates.production_migration, DEFAULT_POLICY.gates.production_migration);
  assert.equal(merged.routing.roles.search.model, 'haiku');
});

test('policy validation rejects unsupported YAML and unsafe or inconsistent rules', () => {
  for (const text of ['version: 1\nversion: 1', 'version: 1\n gates: yes', 'version: 1\ngates: &alias',
    'version: 1\ngates:\n  force_push: block # comment', 'version: 2',
    'version: 1\nmodel_allowlist: [haiku]',
    'version: 1\neffort:\n  default_by_task:\n    code_edit: max',
    'version: 1\ngates:\n  force_push: dance',
    'version: 1\nextra: true']) {
    assert.throws(() => parsePolicy(text), undefined, text);
  }
  assert.throws(() => parsePolicy({ version: 1, routing: { roles: { search: { model: 'bad model' } } } }));
});

test('repository and organization policies reject reserved keys before merging', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = JSON.stringify({ version: 1, routing: { roles: { search: {
      [key]: { with_verifying_test: 'opus', synthetic_unknown: true },
    } } } });
    assert.throws(() => parsePolicy(input), /Reserved policy property/u);
    assert.throws(() => parsePolicy('{"version":1}', input), /Reserved policy property/u);
    assert.throws(() => parsePolicyDocument(JSON.parse(input)), /Reserved policy property/u);
  }
  assert.throws(() => parsePolicy('{"version":1}',
    '{"version":1,"routing":{"roles":{"search":{"synthetic_unknown":true}}}}'), /Invalid route/u);
  assert.equal(Object.prototype.with_verifying_test, undefined);
});

test('validated organization overrides have the same semantics after serialization', () => {
  const policy = parsePolicy({ version: 1 }, { version: 1,
    routing: { roles: { search: { with_verifying_test: 'opus' } } } });
  assert.equal(policy.routing.roles.search.with_verifying_test, 'opus');
  assert.equal(Object.hasOwn(policy.routing.roles.search, 'with_verifying_test'), true);
  assert.deepEqual(parsePolicy(JSON.stringify(policy)), policy);
  const inherited = Object.create({ with_verifying_test: 'opus' });
  inherited.model = 'haiku';
  assert.throws(() => parsePolicy({ version: 1, routing: { roles: { search: inherited } } }), /plain mappings/u);
});
