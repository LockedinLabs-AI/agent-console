// Regression tests for the runtime paths code scanning flagged: each one pins
// the behaviour the hardening kept, or the bug it fixed.
import assert from "node:assert/strict";
import { test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { readConfig } from "../lib/config.js";
import { pollDelay, POLL_MIN_MS, POLL_MAX_MS } from "../lib/hub/local.js";
import { createReportingHandler } from "../lib/hub/routes.js";
import { createRegistry } from "../lib/hub/registry.js";
import { createStore } from "../lib/hub/store.js";
import { pruneParserState, runOnce } from "../lib/collector/collector.js";
import { pinMatches, fingerprint } from "../lib/collector/pinned.js";
import { selfSignedCertificate } from "../lib/hub/tls.js";
import { consolePortProbe, logTail } from "../lib/reporter.js";
import { policyApply, policyStatus, readManifest } from "../lib/policy/cli.js";

const PRICES = JSON.parse(fs.readFileSync(new URL("../lib/collector/prices.json", import.meta.url), "utf8"));

function scratch(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-scan-" + name + "-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("an unbounded poll interval from the environment is capped, so the console never reads its transcripts in a tight loop", () => {
  // Above 2^31-1 ms Node fires a timer after 1 ms: uncapped, this read the disk continuously.
  assert.equal(readConfig([], { AGENT_CONSOLE_POLL_MS: "99999999999" }).pollMs, 3_600_000);
  assert.equal(readConfig([], { AGENT_CONSOLE_POLL_MS: "15000" }).pollMs, 15000);
  assert.equal(readConfig([], { AGENT_CONSOLE_POLL_MS: "5" }).pollMs, 1000);
  assert.equal(pollDelay(2 ** 40), POLL_MAX_MS);
  assert.equal(pollDelay(Infinity), POLL_MIN_MS);
  assert.equal(pollDelay(Number.NaN), POLL_MIN_MS);
  assert.equal(pollDelay("5000"), POLL_MIN_MS);
  assert.equal(pollDelay(-1), POLL_MIN_MS);
  assert.equal(pollDelay(60_000), 60_000);
});

test("a demonstration console checks a machine's token and still refuses it, on ingest and on leave", async () => {
  const registry = createRegistry({ dir: null });
  const store = createStore({ dir: null, retentionMs: 86_400_000, prices: PRICES });
  const { code } = registry.invite({});
  const { token } = registry.redeem(code);
  const call = async (demo, url) => {
    const handle = createReportingHandler({ config: { demo, retentionDays: 8, allowPublic: false }, registry, store, version: "0.0.0", publicDir: process.cwd() });
    const req = Object.assign(Readable.from([Buffer.from("{}")]),
      { method: "POST", url, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, socket: { remoteAddress: "127.0.0.1" } });
    let status = 0;
    await handle(req, { writeHead: (s) => { status = s; }, end: () => {} }, { secure: true });
    return status;
  };
  assert.equal(await call(true, "/api/ingest"), 401);
  assert.equal(await call(true, "/api/leave"), 401);
  // The same token is a machine's on a real console: the refusal above is the demonstration's, not the token's.
  assert.notEqual(await call(false, "/api/ingest"), 401);
});

test("pruning keyed transcript state never writes or deletes by a key read from disk", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const old = "2025-01-01T00:00:00Z", recent = "2026-08-31T23:00:00Z";
  // JSON.parse makes "__proto__" an ordinary own key, as a state file would.
  const parser = JSON.parse(`{"claudeUsage":{"__proto__":{"firstAt":"${recent}","polluted":true},"a":{"firstAt":"${old}"},"b":{"firstAt":"${recent}"}}}`);
  assert.equal(pruneParserState(parser, now), true);
  assert.deepEqual(Object.keys(parser.claudeUsage).sort(), ["__proto__", "b"]);
  assert.ok(Object.hasOwn(parser.claudeUsage, "__proto__"));
  assert.equal(Object.getPrototypeOf(parser.claudeUsage), Object.prototype);
  assert.equal(parser.claudeUsage.polluted, undefined);
  assert.equal(({}).polluted, undefined);
});

test("a cursor file with a negative offset or a __proto__ source is read without failing the transcript or touching prototypes", async (t) => {
  const root = scratch(t, "cursor");
  const source = path.join(root, "logs");
  const directory = path.join(root, "state");
  fs.mkdirSync(source);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "enrollment.json"), JSON.stringify({ v: 1, organizationId: "synthetic-org",
    device: { id: "device-a", label: "Workstation" }, orgSalt: Buffer.alloc(32, 7).toString("base64url") }), { mode: 0o600 });
  const line = JSON.stringify({ type: "assistant", uuid: "line-1", sessionId: "synthetic-session", cwd: "/synthetic", timestamp: new Date().toISOString(),
    isSidechain: false, message: { id: "one", model: "unknown-model-test", usage: { input_tokens: 10, output_tokens: 4 } } });
  fs.writeFileSync(path.join(source, "synthetic.jsonl"), line + "\n");
  const data = { directory, roots: [{ tool: "claude-code", directory: source }], prices: PRICES };
  await runOnce({ ...data, summary: true });
  const cursorFile = path.join(directory, "cursor-v2.json");
  const cursor = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
  const [key] = Object.keys(cursor.sources);
  assert.ok(key);
  cursor.sources[key].offset = -5;
  cursor.sources[key].size = -5;
  const text = JSON.stringify(cursor).replace('"sources":{', '"sources":{"__proto__":{"offset":1,"generation":0,"parser":{},"anchor":"","polluted":true},');
  fs.writeFileSync(cursorFile, text, { mode: 0o600 });
  const summary = await runOnce({ ...data, summary: true });
  // Before, Buffer.alloc(-5) threw and the transcript was counted unreadable.
  assert.equal(summary.coverage.unreadableFiles, 0);
  const after = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
  assert.equal(Object.hasOwn(after.sources, "__proto__"), false, "a source no file stands for is let go");
  assert.equal(after.sources[key].offset > 0, true);
  assert.equal(({}).polluted, undefined);
});

test("the pin accepts exactly the pinned certificate", () => {
  const a = new crypto.X509Certificate(selfSignedCertificate().cert);
  const b = new crypto.X509Certificate(selfSignedCertificate().cert);
  assert.equal(pinMatches(a, fingerprint(a.raw)), true);
  assert.equal(pinMatches(b, fingerprint(a.raw)), false);
  assert.equal(pinMatches(null, fingerprint(a.raw)), false);
  assert.equal(pinMatches(a, undefined), false);
});

test("a join link is checked against the console's own sign-in port only when it names this machine", () => {
  assert.equal(consolePortProbe("https://127.0.0.1:6787"), "http://127.0.0.1:6787/api/hello");
  assert.equal(consolePortProbe("https://localhost:6787"), "http://127.0.0.1:6787/api/hello");
  assert.equal(consolePortProbe("https://[::1]:6787"), "http://127.0.0.1:6787/api/hello");
  // Any other address is never asked anything over plain HTTP.
  for (const hub of ["https://192.168.1.20:6787", "https://10.0.0.5:6788", "https://metadata.internal:80", "https://169.254.169.254:80",
    "https://127.0.0.1.example.com:6787", "not a url"]) {
    assert.equal(consolePortProbe(hub), null, hub);
  }
});

test("the background reporter's log is read back through the descriptor it was opened with", (t) => {
  const dir = scratch(t, "log");
  const log = path.join(dir, "reporter.log");
  const fd = fs.openSync(log, "a+", 0o600);
  try {
    fs.writeSync(fd, "one\ntwo\nthree\n");
    // The name now points elsewhere; what was opened is what is read.
    // (Windows does not rename a file that is open.)
    if (process.platform !== "win32") {
      fs.renameSync(log, log + ".moved");
      fs.writeFileSync(log + ".other", "SOMETHING ELSE\n");
      fs.renameSync(log + ".other", log);
    }
    assert.equal(logTail(fd, 3), "two\nthree\n");
  } finally { fs.closeSync(fd); }
});

test("the policy install manifest is checked and read through one descriptor", (t) => {
  const root = scratch(t, "policy");
  fs.writeFileSync(path.join(root, "agent-policy.yaml"), "version: 1\n");
  const stateDir = path.join(root, "private");
  assert.equal(policyStatus(root, { stateDir }).state, "not-installed");
  policyApply(root, { stateDir });
  assert.equal(policyStatus(root, { stateDir }).state, "installed");
  const manifest = path.join(stateDir, crypto.createHash("sha256").update(path.resolve(root)).digest("hex"), "install", "manifest.json");
  assert.ok(readManifest(manifest).length > 0);
  assert.throws(() => readManifest(manifest + ".absent"), { code: "ENOENT" });
  if (process.platform !== "win32") {
    // A link in the manifest's place is refused, not followed.
    const copy = manifest + ".real";
    fs.renameSync(manifest, copy);
    fs.symlinkSync(copy, manifest);
    assert.throws(() => readManifest(manifest));
    assert.equal(policyStatus(root, { stateDir }).state, "invalid");
    fs.rmSync(manifest);
    fs.renameSync(copy, manifest);
  }
  fs.appendFileSync(manifest, " ".repeat(70_000));
  assert.equal(policyStatus(root, { stateDir }).state, "invalid");
});

test("tooltips of fitted lines are read from parsed markup, never by stripping tags with a pattern", () => {
  const source = fs.readFileSync(new URL("../public/console.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /x\.html\.replace\(/u);
  assert.match(source, /const textOf = \(html\) => \{ const t = document\.createElement\("template"\); t\.innerHTML = html; return t\.content\.textContent \|\| ""; \};/u);
  assert.match(source, /x\.text \?\? textOf\(x\.html\)/u);
});
