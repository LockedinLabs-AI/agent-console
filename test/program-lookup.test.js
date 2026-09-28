/**
 * Helper programs come from PATH only (lib/programs.js).
 *
 * The variable that keeps Windows program lookup to PATH is set before
 * anything can start a program: each entry point, and every module that
 * starts one, imports lib/programs.js first. On Windows each program is also
 * named by its full path: git as PATH finds it, never in or beneath the folder
 * it runs in, and cmd and PowerShell from the system folder. On macOS and
 * Linux every program is started as before. All of this runs on every
 * platform except the last test, which needs Windows itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PATH_ONLY, searchPathOnly, programOnPath, systemProgram } from "../lib/programs.js";
import { createGitStatsStore, gitProgram, repoToplevel } from "../lib/gitstats.js";
import { createAlerts } from "../lib/hub/alerts.js";
import { confirmedReporter } from "../lib/reporter.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECORDER = pathToFileURL(path.join(ROOT, "test", "helpers", "record-programs.mjs")).href;
const WINDOWS = process.platform === "win32";
// The real functions, whatever a test below replaces for a while.
const { spawnSync, execFileSync } = childProcess;

function scratch(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-" + name + "-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

/** True when `file` is `folder` or beneath it, compared as Windows compares paths. */
function inside(folder, file) {
  const rel = path.win32.relative(folder, file);
  return !(rel === ".." || rel.startsWith("..\\") || path.win32.isAbsolute(rel));
}

/** A made-up Windows disk: the files on it and its folder links. Names match in any case. */
function windowsDisk(files, links = {}) {
  const real = (p) => {
    for (const [link, target] of Object.entries(links)) {
      if (inside(link, p)) return path.win32.join(target, path.win32.relative(link, p));
    }
    return p;
  };
  const present = new Set(files.map((file) => file.toLowerCase()));
  return { exists: (p) => present.has(real(p).toLowerCase()), real };
}

/**
 * Runs `run` with every child_process function replaced: each call is
 * recorded with the lookup variable as it stood, and nothing is started.
 */
async function recordPrograms(run) {
  const calls = [];
  const saved = {};
  for (const call of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    saved[call] = childProcess[call];
    childProcess[call] = (file, ...rest) => {
      calls.push({ file: String(file), variable: process.env[PATH_ONLY] ?? null });
      const callback = rest.find((argument) => typeof argument === "function");
      if (callback) process.nextTick(callback, new Error("not started"), "", "");
      if (call === "spawnSync") return { error: new Error("not started"), status: null, stdout: "", stderr: "" };
      if (call.endsWith("Sync")) throw new Error("not started");
      return { on() { return this; }, once() { return this; }, unref() {}, kill() {} };
    };
  }
  syncBuiltinESMExports();
  try {
    await run();
  } finally {
    Object.assign(childProcess, saved);
    syncBuiltinESMExports();
  }
  return calls;
}

test("importing lib/programs.js sets the lookup variable, and setting it changes nothing else", async () => {
  assert.equal(PATH_ONLY, "NoDefaultCurrentDirectoryInExePath");
  // A fresh copy of the module, loaded where the variable is not set.
  delete process.env[PATH_ONLY];
  try {
    await import(new URL("../lib/programs.js?fresh", import.meta.url).href);
    assert.equal(process.env[PATH_ONLY], "1");
  } finally {
    searchPathOnly();
  }
  const env = { PATH: "/usr/bin" };
  assert.equal(searchPathOnly(env), env);
  assert.deepEqual(env, { PATH: "/usr/bin", NoDefaultCurrentDirectoryInExePath: "1" });
});

test("every module that starts a program imports lib/programs.js, and each entry point imports it before anything else", () => {
  const files = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(path.join(dir, d.name)) : /\.(?:m?js|cjs)$/u.test(d.name) ? [path.join(dir, d.name)] : []);
  const imports = (source) => [...source.matchAll(/^import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gmu)].map((m) => m[1]);
  const LOOKUP = path.join(ROOT, "lib", "programs.js");
  const lookup = (file) => (specifier = "") => specifier.startsWith(".") && path.resolve(ROOT, path.dirname(file), specifier) === LOOKUP;
  const starting = [];
  for (const file of [...files("lib"), ...files("bin"), "server.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const specifiers = imports(source);
    if (!specifiers.includes("node:child_process") && !/\brequire\(\s*["'](?:node:)?child_process["']\s*\)/u.test(source)) continue;
    starting.push(file.split(path.sep).join("/"));
    assert.ok(specifiers.some(lookup(file)), `${file} can start a program but does not import lib/programs.js`);
  }
  // Every place the console or the reporter starts a program. A new one joins this list
  // once it names its program as lib/programs.js describes.
  assert.deepEqual(starting.sort(), ["lib/gitstats.js", "lib/hub/alerts.js", "lib/reporter.js", "server.js"]);
  for (const entry of ["bin/agent-console.mjs", "server.js"]) {
    const [first] = imports(fs.readFileSync(path.join(ROOT, entry), "utf8"));
    assert.ok(lookup(entry)(first), `${entry} imports ${first} before lib/programs.js`);
  }
});

const REPO = "C:\\work\\repo";
const GIT_DIR = "C:\\Program Files\\Git\\cmd";

test("on Windows, git is the one PATH finds outside the folder it runs in, named by its full path", () => {
  const disk = windowsDisk([
    REPO + "\\git.exe", REPO + "\\git.com", REPO + "\\tools\\git.exe", REPO + "\\node_modules\\.bin\\git.exe",
    GIT_DIR + "\\git.exe", "C:\\Other\\git.exe", "C:\\Both\\git.com", "C:\\Both\\git.exe",
  ], { "C:\\link": REPO + "\\tools", "C:\\PROGRA~1": "C:\\Program Files" });
  const find = (PATH, { cwd = REPO, env = { Path: PATH } } = {}) => programOnPath("git", { cwd, env, platform: "win32", ...disk });

  // Relative entries are read from the working folder; entries in or beneath it, however
  // spelled or linked, and entries relative to a drive are all passed over.
  assert.equal(find([".", "tools", "..\\repo", "", REPO, REPO + "\\tools", "c:\\WORK\\Repo\\Tools\\",
    "C:\\work\\x\\..\\repo\\node_modules\\.bin", "C:\\link", "\\work\\repo\\tools", "C:tools", `"${GIT_DIR}"`, "C:\\Other"].join(";")),
  GIT_DIR + "\\git.exe");
  // Nothing outside it: nothing is found, so nothing is started.
  assert.equal(find([".", REPO, REPO + "\\tools", "C:\\link"].join(";")), null);
  assert.equal(find(undefined, { env: {} }), null);
  // Within a folder, the order Windows uses: .com before .exe.
  assert.equal(find("C:\\Both;C:\\Other"), "C:\\Both\\git.com");
  // PATH in any case; given two spellings, the one Node passes a child.
  assert.equal(find(undefined, { env: { PATH: "C:\\Other", Path: GIT_DIR } }), "C:\\Other\\git.exe");
  // The same folder is fine for a program that runs somewhere else.
  assert.equal(find(REPO + "\\tools", { cwd: "C:\\elsewhere" }), REPO + "\\tools\\git.exe");
  // A working folder named by a short name or a link is still that folder.
  assert.equal(find(GIT_DIR, { cwd: "C:\\PROGRA~1" }), null);
  assert.equal(find(REPO + "\\tools", { cwd: "C:\\link" }), null);
  // Elsewhere the name comes back as given: those systems look only on PATH.
  for (const platform of ["linux", "darwin"]) {
    assert.equal(programOnPath("git", { cwd: "/work/repo", env: { PATH: "/work/repo:/usr/bin" }, platform }), "git");
  }

  // The console's own git: this lookup on Windows, and /usr/bin/git, as before, elsewhere.
  const PATH = [".", REPO + "\\tools", GIT_DIR].join(";");
  assert.equal(gitProgram(REPO, { platform: "win32", env: { PATH }, ...disk }), GIT_DIR + "\\git.exe");
  assert.equal(gitProgram(REPO, { platform: "win32", env: { PATH: "." }, ...disk }), null);
  for (const platform of ["linux", "darwin"]) assert.equal(gitProgram("/work/repo", { platform, env: { PATH } }), "/usr/bin/git");
});

test("whatever PATH holds, the git found on Windows is a full path never in or beneath the folder it runs in", () => {
  const entries = [".", "", "tools", "..", "..\\repo", REPO, REPO + "\\", REPO + "\\tools", "C:\\WORK\\REPO\\BIN",
    REPO + "\\node_modules\\.bin", "C:\\work\\x\\..\\repo", "C:\\link", "C:\\link\\sub", "D:\\tools", "C:\\work", "C:\\work\\repo2",
    GIT_DIR, `"${GIT_DIR}"`, "C:\\Other", "\\\\host\\share\\bin", "\\work\\repo", "C:repo", "'C:\\Other'"];
  // Every folder holds a git: only the lookup's own rules keep one from being chosen.
  const disk = windowsDisk([], { "C:\\link": REPO + "\\tools", "D:\\tools": REPO + "\\deep" });
  const anywhere = { exists: () => true, real: disk.real };
  let seed = 20260928;
  const pick = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  let found = 0;
  for (const cwd of [REPO, "c:\\WORK\\REPO\\", "C:\\link", "\\\\host\\share"]) {
    for (let i = 0; i < 400; i += 1) {
      const PATH = Array.from({ length: 1 + pick(6) }, () => entries[pick(entries.length)]).join(";");
      const git = programOnPath("git", { cwd, env: { PATH }, platform: "win32", ...anywhere });
      if (git === null) continue;
      found += 1;
      assert.match(git, /^(?:[A-Za-z]:\\|\\\\[^\\])/u, `not a full path: ${git} from ${PATH}`);
      const folder = path.win32.resolve(cwd);
      assert.ok(!inside(folder, git) && !inside(disk.real(folder), disk.real(git)), `${git} is in ${cwd}; PATH was ${PATH}`);
    }
  }
  assert.ok(found > 400, "the PATHs tried almost never found a program");
});

test("on Windows, cmd and PowerShell are started from the system folder by their full paths", () => {
  assert.equal(systemProgram("cmd.exe", { env: { SystemRoot: "C:\\Windows" } }), "C:\\Windows\\System32\\cmd.exe");
  assert.equal(systemProgram("WindowsPowerShell\\v1.0\\powershell.exe", { env: { SYSTEMROOT: "D:\\WIN" } }),
    "D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  // A system folder not named in full is no system folder: the caller falls back to the
  // bare name, which the lookup variable keeps to PATH.
  for (const SystemRoot of [undefined, "", "Windows", "\\Windows", "C:Windows"]) {
    assert.equal(systemProgram("cmd.exe", { env: { SystemRoot } }), null, String(SystemRoot));
  }
});

test("the reporter asks ps about a locked process as before, except on Windows, where it starts none", (t) => {
  const lock = path.join(scratch(t, "lock"), "reporter.lock");
  fs.writeFileSync(lock, "{}\n");
  const asked = [];
  const ps = (...args) => { asked.push(args.slice(0, 2)); return { status: 0, stdout: "node /opt/agent-console/bin/agent-console.mjs report\n" }; };
  // This test's parent process is alive, and the lock was just touched.
  for (const platform of ["linux", "darwin", "win32"]) assert.equal(confirmedReporter(process.ppid, lock, { platform, ps }), true, platform);
  assert.deepEqual(asked, [["ps", ["-o", "command=", "-p", String(process.ppid)]], ["ps", ["-o", "command=", "-p", String(process.ppid)]]]);
});

test("every program the console starts sees the variable set; on Windows it is named by its full path, elsewhere as before", async (t) => {
  const dir = scratch(t, "programs");
  const lock = path.join(dir, "reporter.lock");
  fs.writeFileSync(lock, "{}\n");
  let clock = Date.now();
  const calls = await recordPrograms(async () => {
    // git, in a folder a session worked in.
    await repoToplevel(createGitStatsStore(), dir);
    // The desktop notifier, for a live alert: the same tool call five times.
    const engine = createAlerts({ notify: true, repeat: 5, now: () => clock });
    for (let i = 0; i < 5; i += 1) {
      engine.observeLine({ tool: "claude-code", sessionHash: "synthetic-session", hashIdentity: (kind, value) => kind + value,
        line: { type: "assistant", timestamp: new Date(clock).toISOString(),
          message: { content: [{ type: "tool_use", id: "call-" + i, name: "Bash", input: { command: "true" } }] } } });
      clock += 1000;
    }
    // The reporter's check on the process its lock names; this test's parent is alive.
    confirmedReporter(process.ppid, lock);
  });
  for (const call of calls) assert.equal(call.variable, "1", `${call.file} was started before the variable was set`);
  const git = gitProgram(dir);
  if (WINDOWS && git) assert.ok(!inside(fs.realpathSync.native(dir), fs.realpathSync.native(git)), git);
  const notifier = { win32: systemProgram("WindowsPowerShell\\v1.0\\powershell.exe"), darwin: "osascript" }[process.platform] || "notify-send";
  // Windows has no ps that can answer, so the reporter starts none there.
  assert.deepEqual(calls.map((call) => call.file), [...(git ? [git] : []), notifier, ...(WINDOWS ? [] : ["ps"])]);
});

test("each entry point sets the variable before it starts a program", async (t) => {
  const dir = scratch(t, "entry");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== PATH_ONLY.toUpperCase()));
  const opener = { darwin: "/usr/bin/open", win32: systemProgram("cmd.exe") }[process.platform] || "xdg-open";
  for (const entry of ["bin/agent-console.mjs", "server.js"]) {
    // The opener is the first program a demo console started with --open runs; the
    // recorder ends the process there, before anything is started.
    const run = spawnSync(process.execPath, ["--import", RECORDER, path.join(ROOT, entry), "--demo", "--json", "--open", "--port", "0", "--report-port", "0"],
      { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 0, `${entry}: ${run.stderr}`);
    const calls = run.stderr.split(/\r?\n/u).filter((line) => line.startsWith("RECORDED ")).map((line) => JSON.parse(line.slice(9)));
    assert.deepEqual(calls, [{ call: "execFile", file: opener, variable: "1" }], entry);
  }
});

test("Windows: the git the console runs comes from PATH, not from the folder it reads", { skip: !WINDOWS && "Windows only" }, async (t) => {
  const repo = scratch(t, "lookup");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // Node itself under git's name: it answers --version with "v…", where git says "git version …".
  fs.copyFileSync(process.execPath, path.join(repo, "git.exe"));

  // The variable alone: a program started by its bare name in that folder is PATH's.
  assert.equal(process.env[PATH_ONLY], "1");
  assert.match(execFileSync("git", ["--version"], { cwd: repo, encoding: "utf8" }), /^git version /u);

  // The full path alone, with the variable taken away: the console's git is still PATH's.
  delete process.env[PATH_ONLY];
  try {
    const git = programOnPath("git", { cwd: repo });
    assert.ok(git && !inside(fs.realpathSync.native(repo), fs.realpathSync.native(git)), String(git));
    const top = await repoToplevel(createGitStatsStore(), repo);
    assert.equal(path.win32.basename(String(top)).toLowerCase(), path.win32.basename(repo).toLowerCase());
  } finally {
    searchPathOnly();
  }
});
