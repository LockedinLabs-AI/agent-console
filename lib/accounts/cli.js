import '../programs.js';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { accountStore } from './store.js';
import { claudeCapacity, PROVIDERS, recommend } from './capacity.js';
import { capacityService, nativeEnvironment, nativeProgram } from './native.js';

const HELP = `Account capacity (native sign-in; no API key needed)

  accounts list [--state-dir DIR]
  accounts add --id ID --provider codex|claude-code --label LABEL --home NATIVE_HOME
  accounts refresh --id ID
  accounts capture --id ID           Read Claude status-line JSON from stdin
  accounts recommend --provider codex|claude-code
  accounts run --provider codex|claude-code -- [native arguments]
  accounts launch --id ID -- [native arguments]

Every command accepts --state-dir DIR (the console hub state directory).
Register one native home per account; sign in with the unmodified native CLI.
Run selects a fresh, available profile with the earliest long-window reset.
It never switches accounts mid-session or retries on another account.
Launch uses the named profile, including for its native login command.
Capture stores quota numbers only; no transcript, email, or credential is saved.
`;

export async function accountsMain(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const command = argv.shift();
  if (!command || command === 'help' || command === '--help') { stdout.write(HELP); return 0; }
  const flags = {}, extra = [];
  const allowed = new Set(['id', 'provider', 'label', 'home', 'state-dir']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') { extra.push(...argv.slice(i + 1)); break; }
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || Object.hasOwn(flags, key)) throw new Error('Invalid account option. Run accounts help.');
    flags[key] = argv[++i];
  }
  const stateDir = path.resolve(flags['state-dir'] || env.AGENT_CONSOLE_STATE_DIR
    || path.join(env.AGENT_CONSOLE_HOME || os.homedir(), '.agent-console', 'hub'));
  const store = accountStore(stateDir);
  if (command === 'add') {
    store.add({ id: flags.id, provider: flags.provider, label: flags.label, directory: flags.home });
    stdout.write('Profile registered. Connect its quota source in the Accounts view.\n'); return 0;
  }
  if (command === 'capture') {
    const p = store.get(flags.id);
    if (p.provider !== 'claude-code') throw new Error('Capture requires a Claude Code profile.');
    let input = '', size = 0;
    for await (const chunk of stdin) {
      size += Buffer.byteLength(chunk);
      if (size > 64 * 1024) throw new Error('Status-line input is too large.');
      input += chunk;
    }
    let data;
    try { data = JSON.parse(input); } catch { throw new Error('Status-line input is not valid JSON.'); }
    const snapshot = claudeCapacity(data);
    store.snapshot(p.id, snapshot);
    stdout.write('Claude · ' + snapshot.windows.map(w => w.remainingPercent === null ? `${w.label}: unavailable`
      : `${w.label}: ${Math.round(w.remainingPercent)}% left`).join(' · ') + '\n');
    return 0;
  }
  if (command === 'refresh') {
    stdout.write(JSON.stringify(await capacityService(store).refresh(flags.id)) + '\n'); return 0;
  }
  if (command === 'list') { stdout.write(JSON.stringify(store.view()) + '\n'); return 0; }
  if (command === 'recommend' || command === 'run') {
    if (!Object.hasOwn(PROVIDERS, flags.provider)) throw new Error('Choose --provider codex or claude-code.');
    if (command === 'run' && flags.provider === 'codex') {
      const service = capacityService(store);
      for (const p of store.profiles().filter(p => p.provider === 'codex' && p.enabled)) await service.refresh(p.id);
    }
    const pick = recommend(store.view().profiles, flags.provider);
    if (command === 'recommend') { stdout.write(JSON.stringify(pick || { profileId: null, reason: 'No fresh, complete, available profile. Open Accounts to connect or refresh.' }) + '\n'); return pick ? 0 : 1; }
    if (!pick) throw new Error('No fresh, complete, available profile. Open Accounts to connect or refresh.');
    flags.id = pick.profileId;
  } else if (command !== 'launch') throw new Error('Unknown account command. Run accounts help.');
  const p = store.get(flags.id);
  // Never silently replace the caller's requested account after launch.
  const childEnv = nativeEnvironment(p, env), executable = nativeProgram(p.provider, childEnv);
  stderr.write(`Opening ${PROVIDERS[p.provider]} with profile ${p.id}. This session stays on that profile.\n`);
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, extra, { env: childEnv, stdio: 'inherit', shell: false });
    child.once('error', () => reject(new Error('The native client could not start.')));
    child.once('exit', (code, signal) => resolve(signal ? 130 : code ?? 1));
  });
}
