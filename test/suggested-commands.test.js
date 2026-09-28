/**
 * The commands a console suggests when it cannot start keep everything the
 * person gave it (lib/invocation.js commandWith): "start on another port"
 * starts this same console, with its data folder and its transcripts, never a
 * fresh one on the default folder. Under --json the failure is one JSON line.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { commandWith } from "../lib/invocation.js";

const BIN = fileURLToPath(new URL("../bin/agent-console.mjs", import.meta.url));

test("a suggested command keeps every other option, with folders made absolute", () => {
  const base = "node /opt/ac/bin/agent-console.mjs";
  assert.equal(
    commandWith(base, ["--state-dir", "data", "--port", "6800", "--report-port", "6801", "--open"], { "report-port": 6803 }, { platform: "linux", cwd: "/work" }),
    "node /opt/ac/bin/agent-console.mjs --state-dir /work/data --port 6800 --open --report-port 6803");
  assert.equal(
    commandWith(base, ["--state-dir=my data", "--port=6800", "--claude-root", "/logs/claude"], { port: 6802 }, { platform: "linux", cwd: "/work" }),
    "node /opt/ac/bin/agent-console.mjs --state-dir '/work/my data' --claude-root /logs/claude --port 6802",
    "the --name=value form is replaced too, and a folder with a space is quoted for the shell");
  assert.equal(commandWith(base, [], { port: 6789 }, { platform: "linux" }), base + " --port 6789", "nothing given, nothing kept");
  assert.equal(
    commandWith("agent-console", ["--state-dir", "D:\\Agent Console\\data"], { port: 1 }, { platform: "win32", cwd: "D:\\" }),
    "agent-console --state-dir 'D:\\Agent Console\\data' --port 1");
});

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-suggest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("the console did not exit")); }, 20_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, output, errors }); });
  });
}

test("a busy reporting port is one JSON line under --json, and its suggestion keeps the data folder", async (t) => {
  const dir = scratch(t);
  const busy = net.createServer();
  await new Promise((resolve) => busy.listen(0, "127.0.0.1", resolve));
  t.after(() => busy.close());
  const port = busy.address().port;

  const result = await run(["--json", "--no-local", "--state-dir", dir, "--port", "0", "--report-port", String(port)]);
  assert.equal(result.code, 1);
  assert.equal(result.errors, "", "nothing is written as text under --json");
  const failure = JSON.parse(result.output.trim().split("\n")[0]);
  assert.equal(failure.ok, false);
  assert.equal(failure.event, "error");
  assert.equal(failure.kind, "report-port-busy");
  assert.match(failure.message, new RegExp(`Port ${port} \\(for other machines to report on\\) is already in use`, "u"));
  const suggested = /Choose another: (.*?--report-port \d+)/u.exec(failure.message);
  assert.ok(suggested, "a command to start on another port");
  assert.ok(suggested[1].includes("--state-dir " + dir) || suggested[1].includes(`--state-dir '${dir}'`),
    "the suggestion starts this console, on its own data folder: " + suggested[1]);
  assert.ok(suggested[1].includes("--no-local"), "and keeps what it reads");

  // Without --json the same failure is words on stderr, and the same command.
  const words = await run(["--no-local", "--state-dir", dir, "--port", "0", "--report-port", String(port)]);
  assert.equal(words.code, 1);
  assert.match(words.errors, /Choose another: .*--state-dir .*--report-port \d+/u);
});
