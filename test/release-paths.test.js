// The release pipeline's scripts refuse paths and addresses outside the place
// they were meant for: a linked label, a folder outside the checkout, an
// executable by another name, a non-GitHub request, a console not on this machine.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { insideRoot, namedRegularFile } from "../scripts/release-paths.mjs";
import { readLabels, signingNotes } from "../scripts/release-signing-notes.mjs";
import { authorizeChecks } from "../scripts/release-source-check.mjs";
import { windowsRoot } from "../scripts/readme-install.mjs";
import { waitUntilNotarized } from "../packaging/sea/notarized.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const links = process.platform !== "win32";

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-release-paths-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("insideRoot accepts a folder in the root and refuses one outside it, the root itself and a link out", (t) => {
  const dir = scratch(t);
  const root = path.join(dir, "checkout");
  fs.mkdirSync(path.join(root, "labels"), { recursive: true });
  fs.mkdirSync(path.join(dir, "elsewhere"));
  assert.equal(insideRoot("labels", { root }), path.join(root, "labels"));
  assert.throws(() => insideRoot("../elsewhere", { root }), /must be inside/u);
  assert.throws(() => insideRoot(path.join(dir, "elsewhere"), { root }), /must be inside/u);
  assert.throws(() => insideRoot(".", { root }), /must be inside/u);
  assert.throws(() => insideRoot("missing", { root }), /does not exist/u);
  assert.throws(() => insideRoot("", { root }), /must be a path/u);
  if (links) {
    fs.symlinkSync(path.join(dir, "elsewhere"), path.join(root, "out"));
    assert.throws(() => insideRoot("out", { root }), /must be inside/u, "a link inside that points out is refused");
  }
});

test("namedRegularFile refuses another name, a folder and a link", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "SHA256SUMS");
  fs.writeFileSync(file, "synthetic\n");
  assert.equal(namedRegularFile(file, /^SHA256SUMS$/u), file);
  assert.throws(() => namedRegularFile(file, /^agent-console$/u), /unexpected name/u);
  fs.mkdirSync(path.join(dir, "agent-console"));
  assert.throws(() => namedRegularFile(path.join(dir, "agent-console"), /^agent-console$/u), /regular file/u);
  if (links) {
    fs.symlinkSync(file, path.join(dir, "linked"));
    assert.throws(() => namedRegularFile(path.join(dir, "linked"), /^linked$/u), /regular file/u);
  }
});

test("the release notes read only regular label files named as the build names them", (t) => {
  const dir = scratch(t);
  const labels = path.join(dir, "labels");
  fs.mkdirSync(labels);
  fs.writeFileSync(path.join(labels, "agent-console-linux-x64.label"), "agent-console-linux-x64 · Linux, x64 executable\n");
  const read = readLabels("labels", { root: dir });
  assert.equal(read.length, 1);
  assert.match(signingNotes(read), /\*\*Linux, x64\*\*/u);
  assert.deepEqual(readLabels("absent", { root: dir }), [], "no labels folder: no labels, as before");
  assert.throws(() => readLabels(path.join(os.tmpdir()), { root: dir }), /must be inside/u);
  fs.writeFileSync(path.join(labels, "notes.label"), "synthetic\n");
  assert.throws(() => readLabels("labels", { root: dir }), /Unexpected label file/u);
  fs.rmSync(path.join(labels, "notes.label"));
  if (links) {
    const secret = path.join(dir, "outside.txt");
    fs.writeFileSync(secret, "synthetic private text\n");
    fs.symlinkSync(secret, path.join(labels, "agent-console-darwin-arm64.label"));
    assert.throws(() => readLabels("labels", { root: dir }), /regular file/u, "a linked label is never copied into public notes");
  }
});

test("release authorization only ever asks the GitHub API, for a plain owner/name repository", async () => {
  const sha = "a".repeat(40);
  for (const repository of ["../..", "owner/..", "./name", "owner/name/extra", "owner"]) {
    await assert.rejects(authorizeChecks({ repository, sha, token: "synthetic", fetchImpl: () => assert.fail("no request") }),
      /requires a repository/u, repository);
  }
  const asked = [];
  await assert.rejects(authorizeChecks({ repository: "example-org/example-repo", sha, token: "synthetic",
    fetchImpl: async (url) => { asked.push(url); return { ok: false, status: 503 }; } }), /HTTP 503/u);
  assert.equal(asked.length, 1);
  assert.ok(asked[0].startsWith("https://api.github.com/repos/example-org/example-repo/actions/runs?"), asked[0]);
});

test("the install check's Windows cleanup runs taskkill only from a plain Windows folder", () => {
  assert.equal(windowsRoot("C:\\Windows"), "C:\\Windows");
  assert.equal(windowsRoot("D:\\WINNT"), "D:\\WINNT");
  for (const value of [undefined, "", "\\\\server\\share", "C:\\Windows\\..\\Temp", "C:\\Windows & calc", "relative\\Windows", "C:\\Win\"dows"]) {
    assert.equal(windowsRoot(value), "C:\\Windows", String(value));
  }
});

test("the notarization check assesses only a regular file named as a macOS executable", async (t) => {
  const dir = scratch(t);
  const other = path.join(dir, "passwd");
  fs.writeFileSync(other, "synthetic\n");
  await assert.rejects(waitUntilNotarized(other), /unexpected name/u);
  fs.mkdirSync(path.join(dir, "agent-console"));
  await assert.rejects(waitUntilNotarized(path.join(dir, "agent-console")), /regular file/u);
});

test("the Homebrew formula is rendered only from SHA256SUMS into Formula/agent-console.rb", (t) => {
  const dir = scratch(t);
  const sums = path.join(dir, "SHA256SUMS");
  const lines = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
    .map((target, i) => `${String(i + 1).repeat(64)}  agent-console-${target}.tar.gz`);
  fs.writeFileSync(sums, lines.join("\n") + "\n");
  const render = (...args) => spawnSync(process.execPath, [path.join(ROOT, "scripts/render-homebrew-formula.mjs"), "v9.9.9", ...args], { encoding: "utf8" });
  const good = path.join(dir, "tap", "Formula", "agent-console.rb");
  assert.equal(render(sums, good).status, 0);
  assert.match(fs.readFileSync(good, "utf8"), /9\.9\.9/u);
  const wrong = render(sums, path.join(dir, "tap", "elsewhere.rb"));
  assert.equal(wrong.status, 2);
  assert.ok(!fs.existsSync(path.join(dir, "tap", "elsewhere.rb")));
  const renamed = path.join(dir, "sums.txt");
  fs.copyFileSync(sums, renamed);
  assert.notEqual(render(renamed, good).status, 0, "only a file named SHA256SUMS is read");
});

test("the browser probes refuse a console that is not on this machine before loading anything", () => {
  for (const url of ["https://127.0.0.1:6970", "http://example.com", "http://user:pw@127.0.0.1:6970", "file:///etc/hosts"]) {
    const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/ui-probes.mjs"), url, "server.log"],
      { encoding: "utf8", env: { ...process.env, AGENT_CONSOLE_PLAYWRIGHT_DIR: os.tmpdir() } });
    assert.equal(run.status, 2, url);
    assert.match(run.stderr, /only reach a console on this machine|not a URL/u, url);
  }
});

test("the executable smoke test escapes the whole version in its pattern, and the npm lookup encodes every slash", () => {
  const smoke = fs.readFileSync(path.join(ROOT, "packaging/sea/smoke.mjs"), "utf8");
  assert.match(smoke, /new RegExp\(`\^\$\{escapeRegExp\(version\)\}-/u);
  assert.doesNotMatch(smoke, /version\.replace\(\/\\\.\/gu/u);
  const facts = fs.readFileSync(path.join(ROOT, "scripts/site-facts.mjs"), "utf8");
  assert.match(facts, /NPM_NAME\.replaceAll\('\/', '%2f'\)/u);
});
