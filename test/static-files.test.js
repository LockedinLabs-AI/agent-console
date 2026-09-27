/** All paths and replacement bytes in these cases are synthetic scratch data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveFile } from '../lib/hub/http.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-console-static-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'public'), outside = path.join(dir, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'sw.js'), 'synthetic-public-script');
  fs.writeFileSync(path.join(outside, 'synthetic.woff2'), 'synthetic-outside-bytes');
  return { root, outside };
}

function serve(root, rel, method = 'GET') {
  return new Promise((resolve, reject) => {
    const result = {};
    const pending = serveFile({ method }, {
      writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(body) { resolve({ ...result, body: body?.toString() }); },
    }, root, rel);
    pending?.catch(reject);
  });
}

// The server identifies a file by the descriptor it opened, so the race that
// matters is a change to the path after opening. The swap uses the exact name
// the server opened, however the root was spelled, and renames the opened file
// away rather than unlinking it, which Windows allows while it is still open.
function replaceAfterOpen(t, outside) {
  const open = fs.promises.open;
  let replaced = false;
  t.mock.method(fs.promises, 'open', async function (filename, ...args) {
    const handle = await open.call(this, filename, ...args);
    if (!replaced && path.basename(filename) === 'sw.js') {
      replaced = true;
      fs.renameSync(filename, path.join(path.dirname(filename), 'previous.js'));
      fs.renameSync(path.join(outside, 'synthetic.woff2'), filename);
    }
    return handle;
  });
  return () => assert.equal(replaced, true, 'the scheduled substitution ran');
}

test('regular GET and HEAD retain security, MIME and service-worker headers', async (t) => {
  const { root } = fixture(t);
  for (const method of ['GET', 'HEAD']) {
    const answer = await serve(root, 'sw.js', method);
    assert.equal(answer.status, 200);
    assert.equal(answer.body, method === 'GET' ? 'synthetic-public-script' : undefined);
    assert.equal(answer.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(answer.headers['service-worker-allowed'], '/');
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.match(answer.headers['content-security-policy'], /frame-ancestors 'none'/u);
  }
  for (const rel of ['', '../outside/synthetic.woff2', 'absent.js']) assert.equal((await serve(root, rel)).status, 404);
});

test('static files reject a directory symlink beneath the configured root', async (t) => {
  const { root, outside } = fixture(t);
  fs.symlinkSync(outside, path.join(root, 'fonts'), process.platform === 'win32' ? 'junction' : 'dir');
  const answer = await serve(root, 'fonts/synthetic.woff2');
  assert.equal(answer.status, 404);
  assert.ok(!answer.body.includes('synthetic-outside-bytes'));
});

test('a configured root alias still serves its own regular files', async (t) => {
  const { root } = fixture(t);
  const alias = root + '-alias';
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await serve(alias, 'sw.js')).status, 200);
});

test('static files reject leaf symlinks', { skip: process.platform === 'win32' }, async (t) => {
  const { root, outside } = fixture(t);
  fs.symlinkSync(path.join(outside, 'synthetic.woff2'), path.join(root, 'leaf.woff2'));
  assert.equal((await serve(root, 'leaf.woff2')).status, 404);
});

test('static files reject a regular-file replacement after opening', async (t) => {
  const { root, outside } = fixture(t);
  fs.writeFileSync(path.join(outside, 'synthetic.woff2'), 'x'.repeat(fs.statSync(path.join(root, 'sw.js')).size));
  const checked = replaceAfterOpen(t, outside);
  const answer = await serve(root, 'sw.js');
  checked();
  assert.equal(answer.status, 404);
  assert.equal(answer.body, 'not found\n');
});

// Node's JavaScript realpathSync keeps a Windows 8.3 short name (the runner's
// temporary directory is one) where the native realpath returns the long name,
// and on macOS a temporary path differs from its realpath. Every spelling of
// the root must serve the file and refuse its replacement alike.
for (const spelling of ['as given', 'realpathSync', 'realpathSync.native']) {
  test(`a replacement after opening is refused whichever way the root is spelled: ${spelling}`, async (t) => {
    const { root, outside } = fixture(t);
    const spelled = spelling === 'as given' ? root
      : spelling === 'realpathSync' ? fs.realpathSync(root) : fs.realpathSync.native(root);
    t.diagnostic(`root spelling differs from the native realpath: ${spelled !== fs.realpathSync.native(root)}`);
    assert.equal((await serve(spelled, 'sw.js')).status, 200);
    const checked = replaceAfterOpen(t, outside);
    const answer = await serve(spelled, 'sw.js');
    checked();
    assert.equal(answer.status, 404);
  });
}

test('static-file bytes come from the opened descriptor, not a replacement pathname', async (t) => {
  const { root, outside } = fixture(t);
  const open = fs.promises.open;
  let replaced = false;
  t.mock.method(fs.promises, 'open', async function (...args) {
    const handle = await open.apply(this, args), read = handle.read;
    handle.read = async function (...readArgs) {
      if (!replaced) {
        replaced = true;
        fs.renameSync(path.join(root, 'sw.js'), path.join(root, 'previous.js'));
        fs.renameSync(path.join(outside, 'synthetic.woff2'), path.join(root, 'sw.js'));
      }
      return read.apply(this, readArgs);
    };
    return handle;
  });
  const answer = await serve(root, 'sw.js');
  assert.equal(answer.status, 200);
  assert.equal(answer.body, 'synthetic-public-script');
  assert.equal(replaced, true);
});

for (const changed of [false, true]) {
  test(`static identity stays exact above the Number range: ${changed ? 'replacement refused' : 'unchanged accepted'}`, async (t) => {
    const { root, outside } = fixture(t);
    const original = 9007199254740992n, replacement = original + 1n;
    assert.equal(Number(original), Number(replacement));
    fs.writeFileSync(path.join(outside, 'synthetic.woff2'), 'x'.repeat(fs.statSync(path.join(root, 'sw.js')).size));
    const lstat = fs.promises.lstat, open = fs.promises.open;
    let swapped = false;
    // Model exact 64-bit IDs while using real owned files and native Stats:
    // the descriptor keeps the original file, the path moves to the next one.
    const withIdentity = (stat, id, options) => Object.assign(stat, { ino: options?.bigint ? id : Number(id) });
    t.mock.method(fs.promises, 'lstat', async function (filename, options) {
      return withIdentity(await lstat.call(this, filename, options), swapped ? replacement : original, options);
    });
    t.mock.method(fs.promises, 'open', async function (filename, ...args) {
      const handle = await open.call(this, filename, ...args), stat = handle.stat;
      handle.stat = async function (options) { return withIdentity(await stat.call(this, options), original, options); };
      if (changed && !swapped && path.basename(filename) === 'sw.js') {
        fs.renameSync(filename, path.join(path.dirname(filename), 'previous.js'));
        fs.renameSync(path.join(outside, 'synthetic.woff2'), filename);
        swapped = true;
      }
      return handle;
    });
    const answer = await serve(root, 'sw.js');
    assert.equal(swapped, changed, 'the scheduled substitution ran only when asked');
    assert.equal(answer.status, changed ? 404 : 200);
    assert.equal(answer.body, changed ? 'not found\n' : 'synthetic-public-script');
  });
}

test('the static byte limit accepts its boundary and refuses the next byte', async (t) => {
  const { root } = fixture(t);
  const file = path.join(root, 'sw.js'), limit = 8 * 1024 * 1024;
  fs.truncateSync(file, limit);
  const allowed = await serve(root, 'sw.js');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.length, limit);
  fs.truncateSync(file, limit + 1);
  assert.equal((await serve(root, 'sw.js')).status, 404);
});
