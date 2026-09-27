// Property-based fuzzing of the parsers that read untrusted input: policy
// documents, shell commands a coding agent asks to run, tool calls, and text
// that may carry secrets. Each property says the parser answers every input
// with a value or an ordinary Error, and never hangs or crashes the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parsePolicyDocument } from '../lib/analysis/policy.js';
import { shellSegments, classifyTool } from '../lib/policy/classify.mjs';
import { redactText } from '../lib/redact.js';

const RUNS = Number(process.env.FUZZ_RUNS || 2000);
const text = fc.oneof(fc.string({ maxLength: 400 }), fc.string({ unit: 'grapheme', maxLength: 200 }), fc.json());
const shellish = fc.array(fc.constantFrom('ls', 'cat', '.env', '|', '&&', ';', '$(', ')', '`', "'", '"', '\\', ' ', 'sh -c', 'rm -rf /', '~/.ssh/id_rsa', '>', '<<EOF', 'EOF', '\n'), { maxLength: 40 }).map((parts) => parts.join(''));

test('parsePolicyDocument returns a document or throws an Error, for any text', () => {
  fc.assert(fc.property(text, (input) => {
    try { const doc = parsePolicyDocument(input); assert.equal(typeof doc, 'object'); }
    catch (error) { assert.ok(error instanceof Error, `threw a non-Error: ${String(error)}`); }
  }), { numRuns: RUNS });
});

test('shellSegments splits any command without throwing', () => {
  fc.assert(fc.property(fc.oneof(text, shellish), (command) => {
    assert.ok(Array.isArray(shellSegments(command)));
  }), { numRuns: RUNS });
});

test('classifyTool answers any tool call without throwing', () => {
  const call = fc.record({ tool_name: fc.constantFrom('Bash', 'Read', 'Write', 'Edit', 'shell', ''), tool_input: fc.record({ command: fc.oneof(text, shellish), file_path: text }, { requiredKeys: [] }) });
  fc.assert(fc.property(call, (input) => {
    assert.equal(typeof classifyTool(input, '/work/repo', '/home/fuzz'), 'object');
  }), { numRuns: RUNS });
});

test('redactText answers any text, and its output holds nothing more to redact', () => {
  fc.assert(fc.property(text, (input) => {
    const once = redactText(input);
    assert.equal(typeof once.text, 'string');
    assert.ok(Array.isArray(once.kinds));
    assert.deepEqual(redactText(once.text).kinds, [], 'a second pass found a secret the first pass left');
  }), { numRuns: RUNS });
});
