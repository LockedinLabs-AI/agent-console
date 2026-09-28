/**
 * The DCO check (scripts/dco-check.mjs): a commit passes when a Signed-off-by
 * line names its author, merge commits are not checked, Dependabot's own
 * sign-off counts for Dependabot alone, and the log names commits, never people.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEPENDABOT, signedOff } from "../scripts/dco-check.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = path.join(ROOT, "scripts", "dco-check.mjs");
const NAME = "Maintainer";
const EMAIL = "1+maintainer@users.noreply.github.com";
const AUTHOR = `${NAME} <${EMAIL}>`;

test("a sign-off counts when its own line names the commit's author, in any case", () => {
  assert.equal(signedOff(AUTHOR, `Fix counting\n\nSigned-off-by: ${AUTHOR}\n`), true);
  assert.equal(signedOff(AUTHOR, `Fix counting\n\nsigned-off-by: ${AUTHOR.toUpperCase()}\r\nCo-authored-by: Other <2+other@users.noreply.github.com>\n`), true);
  assert.equal(signedOff(AUTHOR, "Fix counting\n"), false, "no sign-off");
  assert.equal(signedOff(AUTHOR, `Fix counting\n\nSigned-off-by: ${NAME} <3+other@users.noreply.github.com>\n`), false, "another address");
  assert.equal(signedOff(AUTHOR, `Fix counting\n\nSigned-off-by: Someone Else <${EMAIL}>\n`), false, "another name");
  assert.equal(signedOff(AUTHOR, `Fix counting, see Signed-off-by: ${AUTHOR}\n`), false, "not a line of its own");
});

test("Dependabot's sign-off counts for Dependabot's commits only", () => {
  assert.equal(signedOff(DEPENDABOT.author, `Bump node\n\nSigned-off-by: ${DEPENDABOT.signoff}\n`), true);
  assert.equal(signedOff(AUTHOR, `Bump node\n\nSigned-off-by: ${DEPENDABOT.signoff}\n`), false);
});

test("the command checks each commit a pull request adds, skips merges, and names no one", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-dco-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: NAME, GIT_AUTHOR_EMAIL: EMAIL, GIT_COMMITTER_NAME: NAME, GIT_COMMITTER_EMAIL: EMAIL };
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env }).trim();
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "start");
  git("switch", "-q", "-c", "topic");
  git("commit", "-q", "--allow-empty", "-s", "-m", "signed off");
  git("switch", "-q", "main");
  git("commit", "-q", "--allow-empty", "-m", "meanwhile on main");
  const base = git("rev-parse", "HEAD");
  git("switch", "-q", "topic");
  git("merge", "-q", "--no-ff", "--no-edit", "main");
  const run = () => spawnSync(process.execPath, [CHECK], { cwd: dir, encoding: "utf8", env: { ...env, BASE: base, HEAD: git("rev-parse", "HEAD") } });

  const clean = run();
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /1 commit checked; all signed off/u, "the merge commit is not checked");

  git("commit", "-q", "--allow-empty", "-m", "forgot");
  const unsigned = git("rev-parse", "HEAD");
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, new RegExp(`::error::Commit ${unsigned.slice(0, 12)} has no Signed-off-by line`, "u"));
  assert.match(failed.stdout, /2 commits checked; 1 not signed off/u);
  assert.ok(!failed.stdout.includes(NAME) && !failed.stdout.includes(EMAIL), "the log repeats no name or address");

  assert.equal(spawnSync(process.execPath, [CHECK], { cwd: dir, encoding: "utf8", env: { ...env, BASE: "main", HEAD: "topic" } }).status, 2);
});
