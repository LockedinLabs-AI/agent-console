/**
 * Where enrolled machines report. Each machine's reporting port is recorded
 * when it joins and on every report (lib/hub/registry.js), so a console
 * started on another port names the machines it cannot reach, by the port they
 * really use; and a one-off --report-port those machines could not find is
 * used for that run only, never kept as the console's port.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistry } from "../lib/hub/registry.js";
import { REPORTER_SEARCH } from "../lib/reporter-search.js";

const BIN = fileURLToPath(new URL("../bin/agent-console.mjs", import.meta.url));

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-console-report-port-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Two free ports too far apart for a reporter's nearby search to cross. */
async function farApart() {
  for (;;) {
    const a = await freePort(), b = await freePort();
    if (Math.abs(a - b) > REPORTER_SEARCH + 1) return [a, b];
  }
}

/** Starts a console with --json and answers its first line; stops it after. */
async function startedWith(t, args) {
  const child = spawn(process.execPath, [BIN, "--json", "--no-local", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolve) => child.once("close", resolve));
  t.after(async () => { if (child.exitCode === null) { child.kill("SIGKILL"); await closed; } });
  let output = "";
  const first = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the console did not start")), 15_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!output.includes("\n")) return;
      clearTimeout(timer);
      resolve(JSON.parse(output.split("\n")[0]));
    });
  });
  child.kill("SIGTERM");
  await closed;
  return first;
}

test("the registry records the port a machine joined and reports on", (t) => {
  const registry = createRegistry({ dir: scratch(t) });
  const joined = registry.redeem(registry.invite({ machine: "Laptop" }).linkCode, { reportPort: 6788 });
  assert.equal(registry.get(joined.device.id).reportPort, 6788);
  registry.touch(joined.device.id, { reportPort: 6790 });
  assert.equal(registry.get(joined.device.id).reportPort, 6790, "it moved to a nearby port and reports there now");
  registry.touch(joined.device.id, { reportPort: "6791" });
  registry.touch(joined.device.id, {});
  assert.equal(registry.get(joined.device.id).reportPort, 6790, "anything but a port leaves it as it was");
});

test("a one-off --report-port names the machines it cannot reach, and is not kept", async (t) => {
  const dir = scratch(t);
  const [joinedOn, oneOff] = await farApart();
  const registry = createRegistry({ dir });
  registry.redeem(registry.invite({ person: "Alex", machine: "Laptop" }).linkCode, { reportPort: joinedOn });
  registry.flush();
  fs.writeFileSync(path.join(dir, "reporting.json"), JSON.stringify({ v: 1, port: joinedOn }) + "\n");

  // A console port of its own: with --port 0 every port is chosen fresh, remembered or not.
  const consolePort = String(await freePort());
  const moved = await startedWith(t, ["--state-dir", dir, "--port", consolePort, "--report-port", String(oneOff)]);
  assert.equal(moved.dashboard.reportPort, oneOff);
  assert.deepEqual(moved.dashboard.machinesElsewhere, [{ port: joinedOn, machines: 1, near: false }],
    "the machine is named by the port it really reports to");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "reporting.json"), "utf8")).port, joinedOn,
    "a port the enrolled machine cannot find is used for that run only");

  const back = await startedWith(t, ["--state-dir", dir, "--port", consolePort]);
  assert.equal(back.dashboard.reportPort, joinedOn, "the next plain start listens where the machine reports");
  assert.deepEqual(back.dashboard.machinesElsewhere, []);
});
