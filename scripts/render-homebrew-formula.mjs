#!/usr/bin/env node
// Render the tap formula only from a release's checked SHA256SUMS file.
import fs from 'node:fs';
import path from 'node:path';
import { namedRegularFile } from './release-paths.mjs';

const [tag, sumsPath, outputPath] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !sumsPath || !outputPath) {
  console.error('Usage: node scripts/render-homebrew-formula.mjs vX.Y.Z SHA256SUMS OUTPUT.rb');
  process.exit(2);
}
// Only the downloaded SHA256SUMS is read, and only the tap's formula file is written.
const sumsFile = namedRegularFile(sumsPath, /^SHA256SUMS$/u, { what: 'SHA256SUMS' });
const outputFile = path.resolve(outputPath);
if (path.basename(outputFile) !== 'agent-console.rb' || path.basename(path.dirname(outputFile)) !== 'Formula') {
  console.error('The output must be <tap checkout>/Formula/agent-console.rb');
  process.exit(2);
}
if (fs.existsSync(outputFile) && !fs.lstatSync(outputFile).isFile()) {
  console.error('Formula/agent-console.rb exists and is not a regular file');
  process.exit(2);
}
const template = fs.readFileSync(new URL('../packaging/homebrew-tap/Formula/agent-console.rb.in', import.meta.url), 'utf8');
const sums = new Map();
for (const line of fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([0-9a-fA-F]{64})\s+\*?([^/\s]+)$/.exec(line);
  if (!match || sums.has(match[2])) throw new Error('Invalid or repeated SHA256SUMS line');
  sums.set(match[2], match[1].toLowerCase());
}
let rendered = template.replaceAll('@VERSION@', tag.slice(1));
for (const [token, file] of [
  ['DARWIN_ARM64', 'agent-console-darwin-arm64.tar.gz'],
  ['DARWIN_X64', 'agent-console-darwin-x64.tar.gz'],
  ['LINUX_ARM64', 'agent-console-linux-arm64.tar.gz'],
  ['LINUX_X64', 'agent-console-linux-x64.tar.gz'],
]) {
  const digest = sums.get(file);
  if (!digest) throw new Error(`Missing SHA-256 for ${file}`);
  rendered = rendered.replaceAll(`@${token}_SHA@`, digest);
}
if (/@[A-Z0-9_]+@/.test(rendered)) throw new Error('Unrendered formula token');
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, rendered);
