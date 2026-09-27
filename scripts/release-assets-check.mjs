#!/usr/bin/env node

// Check the complete native/package set before checksums, attestation or any
// upload. Signing labels are evidence from the platform build, not a substitute
// for its codesign/notarization verification or published-install acceptance.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signingByPlatform } from "./release-signing-notes.mjs";

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"];
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const executable = (target) => `agent-console-${target}${target.startsWith("win32") ? ".exe" : ""}`;

export function expectedAssets(version) {
  if (!VERSION.test(version)) throw new Error("Invalid release version.");
  return [
    ...TARGETS.map(executable),
    ...TARGETS.filter((target) => !target.startsWith("win32")).map((target) => executable(target) + ".tar.gz"),
    `lockedinlabs-agent-console-${version}.tgz`,
  ].sort();
}

function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Release file must be nonempty and regular: ${path.basename(file)}`);
}

export function checkReleaseAssets({ dist, labels, version }) {
  const expected = expectedAssets(version);
  const actual = fs.readdirSync(dist).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Incomplete or unexpected release asset set. Nothing may be uploaded.");
  }
  for (const name of expected) regularFile(path.join(dist, name));
  for (const target of TARGETS) {
    const labelFile = path.join(labels, executable(target) + ".label");
    regularFile(labelFile);
    const signed = signingByPlatform([fs.readFileSync(labelFile, "utf8")]);
    if (!signed.has(target)) throw new Error(`Missing platform signing label: ${target}`);
    if (target.startsWith("darwin") && signed.get(target) !== "signed and notarized") {
      throw new Error(`macOS release executable is not signed and notarized: ${target}`);
    }
  }
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , dist, labels, version] = process.argv;
    const files = checkReleaseAssets({ dist, labels, version });
    process.stdout.write(`Complete release asset set: ${files.length} files, both macOS builds signed and notarized.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
