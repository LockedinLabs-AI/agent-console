#!/usr/bin/env node

/*
 * The Developer Certificate of Origin check (CONTRIBUTING.md, "Sign-off"):
 * every commit a pull request adds carries a Signed-off-by line naming its
 * author, as `git commit -s` writes it. Name and email are compared without
 * regard to case. Merge commits are not checked: they add no change of their
 * own. Dependabot signs off with GitHub's support address rather than the
 * no-reply address it commits under, and that one pair is accepted as written.
 *
 * Like the public-safety check, it never repeats a name or an address in the
 * log: it says which commit, and what to do.
 *
 * Reads BASE and HEAD (commits) from the environment.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEPENDABOT = {
  author: "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>",
  signoff: "dependabot[bot] <support@github.com>", // public-safety: allow email
};

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const signoffs = (message) => [...String(message).matchAll(/^Signed-off-by:[ \t]*(.+)$/gimu)].map((m) => m[1]);

/** Whether a commit message carries a sign-off by `author` ("Name <email>"). */
export function signedOff(author, message) {
  const lines = signoffs(message);
  if (lines.some((line) => same(line, author))) return true;
  return same(author, DEPENDABOT.author) && lines.some((line) => same(line, DEPENDABOT.signoff));
}

function main() {
  const { BASE, HEAD } = process.env;
  if (!/^[0-9a-f]{40}$/u.test(BASE || "") || !/^[0-9a-f]{40}$/u.test(HEAD || "")) {
    process.stderr.write("dco-check: BASE and HEAD must be commit ids\n");
    process.exit(2);
  }
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
  const commits = git("rev-list", "--no-merges", "--reverse", `${BASE}..${HEAD}`).split("\n").filter(Boolean);
  let unsigned = 0;
  for (const sha of commits) {
    const [author, message] = git("show", "-s", "--format=%an <%ae>%x00%B", sha).split("\0");
    if (signedOff(author, message)) continue;
    unsigned += 1;
    const problem = signoffs(message).length
      ? "is signed off, but not by its author: the Signed-off-by name and email must match the commit's"
      : "has no Signed-off-by line";
    process.stdout.write(`::error::Commit ${sha.slice(0, 12)} ${problem}. `
      + "Sign off with git commit -s; CONTRIBUTING.md (Sign-off) shows how to sign off earlier commits.\n");
  }
  process.stdout.write(`dco-check: ${commits.length} commit${commits.length === 1 ? "" : "s"} checked; `
    + `${unsigned ? `${unsigned} not signed off` : "all signed off"}\n`);
  process.exitCode = unsigned ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
