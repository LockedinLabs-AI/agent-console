import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readStateFileSync } from '../hub/state-file.js';
import { PROVIDERS, capacityView, recommend, demoProfiles, storedCapacity } from './capacity.js';

const ID = /^[a-z][a-z0-9-]{0,39}$/u;
const badText = /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
export function validId(id) { return typeof id === 'string' && ID.test(id); }

// Reject links and non-regular files. There is no credential reader here:
// native homes are only passed to the installed native client on demand.
function read(file) {
  try {
    return JSON.parse(readStateFileSync(file, 64 * 1024));
  } catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Account metadata could not be read. Restore the account state file.'); }
}
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Account state must be a private directory, not a link.');
  fs.chmodSync(dir, 0o700);
}
function write(file, value) {
  const dir = path.dirname(file);
  privateDir(dir);
  const temp = path.join(dir, `.write-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
}

export function accountStore(stateDir, { demo = false, now = Date.now } = {}) {
  const dir = stateDir ? path.join(stateDir, 'accounts') : null;
  const file = (id, suffix = '') => {
    if (!validId(id)) throw new Error('Use a profile ID starting with a letter, then up to 39 lowercase letters, digits or hyphens.');
    return path.join(dir, id + suffix + '.json');
  };
  function profiles() {
    if (demo) return [];
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw new Error('Account state is unavailable.'); }
    if (names.length > 150) throw new Error('Too many account state files.');
    return names.filter(n => /^[a-z][a-z0-9-]{0,39}\.json$/u.test(n)).sort().map(n => {
      const p = read(path.join(dir, n));
      if (!p || p.id + '.json' !== n || !validId(p.id) || !Object.hasOwn(PROVIDERS, p.provider)
        || typeof p.label !== 'string' || p.label.length > 40 || badText.test(p.label)
        || typeof p.directory !== 'string' || !path.isAbsolute(p.directory) || typeof p.enabled !== 'boolean') throw new Error('Invalid account profile metadata.');
      return p;
    });
  }
  function get(id) { const p = profiles().find(p => p.id === id); if (!p) throw new Error('Profile not found.'); return p; }
  function add(input) {
    if (demo) throw new Error('The demo does not save profiles.');
    const { id, provider, label, directory } = input || {};
    file(id);
    if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Choose Codex or Claude Code.');
    if (typeof label !== 'string' || !label.trim() || label.length > 40 || badText.test(label)) throw new Error('Use a short profile label without markup or control characters.');
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.length > 4096 || badText.test(directory)) throw new Error('Use the full path of an existing native client home.');
    let real;
    try { real = fs.realpathSync(directory); if (!fs.statSync(real).isDirectory()) throw new Error(); }
    catch { throw new Error('Native client home is not an existing directory. Create it and sign in through the native client first.'); }
    const all = profiles();
    if (all.length >= 32) throw new Error('A local console supports up to 32 profiles.');
    if (all.some(p => p.id === id || p.provider === provider && p.directory === real)) throw new Error('That ID or native client home is already registered.');
    const p = { id, provider, label: label.trim(), directory: real, enabled: true };
    privateDir(dir);
    // Exclusive creation protects concurrent CLI/browser registration.
    fs.writeFileSync(file(id), JSON.stringify(p) + '\n', { flag: 'wx', mode: 0o600 });
    return p;
  }
  function snapshot(id, value) {
    get(id);
    // Only normalizer output is accepted by callers; no raw provider response.
    write(file(id, '.quota'), storedCapacity(value));
  }
  function view() {
    const at = now();
    const list = demo ? demoProfiles(at) : profiles().map(p => {
      let s;
      try { s = read(file(p.id, '.quota')); }
      catch { s = { observedAt: at, error: 'Saved capacity is unreadable. Refresh the native client.' }; }
      if (s && (!Array.isArray(s.windows) || s.windows.length > 40)) s = { observedAt: at, error: 'Saved capacity is incomplete. Refresh the native client.' };
      return capacityView(p, s ? storedCapacity(s) : null, at);
    });
    return { now: at, demo, scope: 'this-machine', profiles: list,
      recommendations: Object.keys(PROVIDERS).map(p => recommend(list, p)).filter(Boolean) };
  }
  function enable(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Enabled must be true or false.');
    write(file(id), { ...get(id), enabled });
  }
  return { profiles, get, add, snapshot, view, enable };
}
