import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { executableCommand, invocation, releaseAsset } from "../lib/invocation.js";

const js = fs.readFileSync(new URL("../public/console.js", import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const start = js.indexOf("  function shownCommand(");
const source = js.slice(start, js.indexOf("\n  }\n", start) + 4);
const show = (command, present) => vm.runInNewContext(source + "\nshownCommand(command)", { command, present });
const marker = "private-install-canary";
const commands = [
  ["verified package", invocation("0.4.0", path.resolve("_npx/synthetic/bin/agent-console.mjs"), {
    AGENT_CONSOLE_PACKAGE: path.resolve(marker, "releases", releaseAsset("0.4.0")),
  }, null)],
  ["source install", invocation("0.4.0", path.resolve(marker + "'s project", "agent-console.mjs"), {}, null)],
  ["quoted Unix executable", executableCommand("/srv/" + marker + "'s project/agent-console", {
    platform: "darwin", env: { PATH: "" }, exists: () => false,
  })],
  ["quoted Windows executable", executableCommand("C:\\" + marker + "'s project\\agent-console.exe", {
    platform: "win32", env: { PATH: "" }, exists: () => false,
  })],
];

for (const [name, command] of commands) {
  test("presenting hides the generated " + name + " command", () => {
    assert.ok(command.includes(marker), "exercise the actual generated private path");
    const ordinary = show(command, false);
    assert.ok(ordinary.includes(marker), "the ordinary view retains the installation location");
    const presented = show(command, true);
    assert.ok(!presented.includes(marker), "no private argument survives presenting");
    assert.match(presented, /hidden while presenting/u, "state why the command is unavailable");
    assert.equal(show(command, false), ordinary, "leaving presenting restores the ordinary display");
  });
}
