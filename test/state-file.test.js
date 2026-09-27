/** Synthetic replacements deliberately schedule races; no live state is read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStateFileSync } from '../lib/hub/state-file.js';
import { interopGeneration, rotateInteropCredential } from '../lib/hub/interop-credentials.js';
import { stateLockOwner, acquireStateLock } from '../lib/hub/state-lock.js';

function fixture(t, filename = 'interop-read-generation.json') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-console-state-read-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, filename);
  return { dir, file };
}

function replaceAfterStat(t, file, replace) {
  const lstat = fs.lstatSync;
  let replaced = false;
  t.mock.method(fs, 'lstatSync', function (filename, ...args) {
    const result = lstat.call(this, filename, ...args);
    if (filename === file && !replaced) { replaced = true; replace(); }
    return result;
  });
  return () => assert.equal(replaced, true, 'the scheduled substitution ran');
}

test('state reads accept the size boundary and preserve initial absence', (t) => {
  const { dir, file } = fixture(t);
  assert.equal(interopGeneration(dir, 'read'), '');
  fs.writeFileSync(file, 'x'.repeat(4096));
  assert.equal(readStateFileSync(file, 4096).length, 4096);
  fs.appendFileSync(file, 'x');
  assert.throws(() => readStateFileSync(file, 4096), /bounded regular file/u);
});

for (const replacement of ['oversized', 'different-inode', 'directory', 'missing']) {
  test(`generation state refuses a ${replacement} replacement after inspection`, (t) => {
    const { dir, file } = fixture(t);
    rotateInteropCredential(dir, 'read');
    const candidate = path.join(dir, 'candidate');
    if (replacement !== 'directory' && replacement !== 'missing') fs.writeFileSync(candidate,
      (replacement === 'oversized' ? ' '.repeat(8192) : '') + JSON.stringify({ v: 1, generation: 'a'.repeat(32) }));
    const checked = replaceAfterStat(t, file, () => {
      fs.unlinkSync(file);
      if (replacement === 'directory') fs.mkdirSync(file);
      else if (replacement !== 'missing') fs.renameSync(candidate, file);
    });
    assert.throws(() => interopGeneration(dir, 'read'), /access is refused/u);
    checked();
  });
}

test('a generation file growing after descriptor validation remains bounded', (t) => {
  const { dir, file } = fixture(t);
  rotateInteropCredential(dir, 'read');
  const read = fs.readSync;
  let largestRequest = 0, grown = false;
  t.mock.method(fs, 'readSync', function (fd, buffer, offset, length, position) {
    largestRequest = Math.max(largestRequest, length);
    if (!grown) { grown = true; fs.appendFileSync(file, ' '.repeat(8192)); }
    return read.call(this, fd, buffer, offset, length, position);
  });
  assert.throws(() => interopGeneration(dir, 'read'), /access is refused/u);
  assert.equal(grown, true);
  assert.ok(largestRequest <= 4097);
});

test('owner-record replacement fails closed without acquiring a second lock', (t) => {
  const { dir, file } = fixture(t, 'hub.lock');
  const first = acquireStateLock(dir);
  const candidate = path.join(dir, 'replacement');
  fs.writeFileSync(candidate, JSON.stringify({ v: 1, pid: process.pid,
    host: 'synthetic-replacement-host', nonce: 'b'.repeat(32) }));
  const checked = replaceAfterStat(t, file, () => { fs.unlinkSync(file); fs.renameSync(candidate, file); });
  assert.equal(stateLockOwner(dir), null);
  checked();
  assert.throws(() => acquireStateLock(dir), { code: 'ELOCKED' });
  first.release();
  assert.equal(fs.existsSync(file), true, 'the original owner does not remove its replacement');
});

test('generation state refuses a symlink substituted after inspection', { skip: process.platform === 'win32' }, (t) => {
  const { dir, file } = fixture(t);
  rotateInteropCredential(dir, 'read');
  const candidate = path.join(dir, 'synthetic-target');
  fs.writeFileSync(candidate, JSON.stringify({ v: 1, generation: 'c'.repeat(32) }));
  const checked = replaceAfterStat(t, file, () => { fs.unlinkSync(file); fs.symlinkSync(candidate, file); });
  assert.throws(() => interopGeneration(dir, 'read'), /access is refused/u);
  checked();
});

for (const changed of [false, true]) {
  test(`state identity stays exact above the Number range: ${changed ? 'replacement refused' : 'unchanged boundary accepted'}`, (t) => {
    const { file, dir } = fixture(t);
    const original = 9007199254740992n, replacement = original + 1n;
    assert.equal(Number(original), Number(replacement));
    fs.writeFileSync(file, 'o'.repeat(4096));
    const next = path.join(dir, 'next');
    fs.writeFileSync(next, 'n'.repeat(4096));
    const lstat = fs.lstatSync, fstat = fs.fstatSync;
    let swapped = false;
    // Model exact 64-bit IDs while using real owned files and native Stats.
    const withIdentity = (stat, id, options) => Object.assign(stat, { ino: options?.bigint ? id : Number(id) });
    t.mock.method(fs, 'lstatSync', function (filename, options) {
      const stat = lstat.call(this, filename, options), id = swapped ? replacement : original;
      if (filename === file && changed && !swapped) {
        fs.unlinkSync(file); fs.renameSync(next, file); swapped = true;
      }
      return withIdentity(stat, id, options);
    });
    t.mock.method(fs, 'fstatSync', function (fd, options) {
      return withIdentity(fstat.call(this, fd, options), swapped ? replacement : original, options);
    });
    if (changed) assert.throws(() => readStateFileSync(file, 4096), /bounded regular file/u);
    else assert.equal(readStateFileSync(file, 4096), 'o'.repeat(4096));
    assert.equal(swapped, changed);
  });
}
