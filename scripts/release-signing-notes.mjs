#!/usr/bin/env node
/*
 * The release notes' "Signing, per platform" section, written only from the
 * labels packaging/sea/build.mjs wrote after signing each executable
 * (labels/<file>.label, e.g. "agent-console-darwin-arm64 · macOS, Apple
 * silicon executable, signed and notarized"). The notes can therefore never
 * claim more than the files carry. release.yml appends it to the notes.
 *
 *   node scripts/release-signing-notes.mjs <labels directory>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insideRoot, namedRegularFile } from "./release-paths.mjs";

const PLATFORMS = [
  { key: "darwin-arm64", name: "macOS, Apple silicon" },
  { key: "darwin-x64", name: "macOS, Intel" },
  { key: "linux-x64", name: "Linux, x64" },
  { key: "linux-arm64", name: "Linux, arm64" },
  { key: "win32-x64", name: "Windows, x64" },
];

// The only files read as labels: what packaging/sea/build.mjs writes.
export const LABEL_FILE = /^agent-console-[a-z0-9]+-[a-z0-9]+(?:\.exe|\.tar\.gz)?\.label$/u;

/** The label files in `dir` (inside the working directory), each a regular file named as build.mjs names them. */
export function readLabels(dir, { root = process.cwd() } = {}) {
  let real;
  try {
    real = insideRoot(dir, { root, what: "The labels folder" });
  } catch (error) {
    if (/does not exist/u.test(error.message)) return [];
    throw error;
  }
  return fs.readdirSync(real).filter((f) => f.endsWith(".label")).sort().map((f) => {
    if (!LABEL_FILE.test(f)) throw new Error(`Unexpected label file: ${f}`);
    return fs.readFileSync(namedRegularFile(path.join(real, f), LABEL_FILE, { what: "A label" }), "utf8");
  });
}

/** What each platform's executable carries, from its label. */
export function signingByPlatform(labels) {
  const found = new Map();
  for (const label of labels) {
    const match = /^agent-console-([a-z0-9]+-[a-z0-9]+)(?:\.exe)? · [^,]+, [^,]+ executable(?:, (.+))?$/u.exec(label.trim());
    if (match) found.set(match[1], match[2] || "");
  }
  return found;
}

function line(platform, status) {
  const file = `\`agent-console-${platform.key}${platform.key.startsWith("win32") ? ".exe" : ""}\``;
  if (status === undefined) return `- **${platform.name}**: no executable in this release.`;
  if (platform.key.startsWith("darwin")) {
    return status === "signed and notarized"
      ? `- **${platform.name}** (${file} and its \`.tar.gz\`): **signed** with an Apple Developer ID (Team ID \`643FW3ZH6M\`, hardened runtime) and **notarized** by Apple. It opens without a Gatekeeper warning, whether installed with \`install.sh\`, Homebrew or a browser download.`
      : `- **${platform.name}** (${file}): **not signed or notarized** (${status || "unsigned"}). macOS stops a browser download of it; see docs/executables.md.`;
  }
  if (platform.key.startsWith("win32")) {
    return `- **${platform.name}** (${file}): **not code-signed**; there is no Authenticode certificate. Install it with \`install.ps1\`, which checks it against \`SHA256SUMS\` before copying it into place, or use Node.js (\`npx.cmd\` or the npm package). Downloaded in a browser instead, SmartScreen may warn before its first start, and Smart App Control refuses it.`;
  }
  return `- **${platform.name}** (${file} and its \`.tar.gz\`): Linux has no code-signing scheme for it; \`SHA256SUMS\` and the build attestation are the check.`;
}

export function signingNotes(labels) {
  const found = signingByPlatform(labels);
  return [
    "",
    "### Signing, per platform",
    "",
    ...PLATFORMS.map((platform) => line(platform, found.get(platform.key))),
    "- **npm package** (`lockedinlabs-agent-console-<version>.tgz`): covered by `SHA256SUMS` and a signed build provenance attestation (`gh attestation verify <file> -R LockedinLabs-AI/agent-console`); on npm it carries npm provenance.",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write("Usage: node scripts/release-signing-notes.mjs <labels directory>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(signingNotes(readLabels(dir)));
  } catch (error) {
    process.stderr.write(`release-signing-notes: ${error.message}\n`);
    process.exit(1);
  }
}
