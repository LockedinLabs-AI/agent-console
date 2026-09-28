/**
 * The machine id that tells this computer's own state lock from another's
 * (lib/hub/machine-id.js): read from the operating system on each platform,
 * kept only as a hash, and stable for a computer whatever network it is on.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { osMachineId, machineHash, machineId } from "../lib/hub/machine-id.js";

const UUID = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";

test("each platform's machine id is read from the operating system, and anything unexpected is none", () => {
  const linux = osMachineId("linux", { readFile: (file) => (file === "/etc/machine-id" ? "0123456789abcdef0123456789abcdef\n" : "") });
  assert.equal(linux, "0123456789abcdef0123456789abcdef");
  const dbus = osMachineId("linux", { readFile: (file) => { if (file === "/etc/machine-id") throw Object.assign(new Error("no"), { code: "ENOENT" }); return "fedcba9876543210fedcba9876543210"; } });
  assert.equal(dbus, "fedcba9876543210fedcba9876543210", "the D-Bus copy is read when /etc/machine-id is missing");
  assert.equal(osMachineId("linux", { readFile: () => "not an id" }), null);

  const ioreg = `+-o Mac  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformUUID" = "${UUID}"\n    }\n`;
  assert.equal(osMachineId("darwin", { run: () => ({ status: 0, stdout: ioreg }) }), UUID);
  assert.equal(osMachineId("darwin", { run: () => ({ status: 1, stdout: "" }) }), null);

  const reg = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${UUID.toLowerCase()}\r\n`;
  assert.equal(osMachineId("win32", { run: () => ({ status: 0, stdout: reg }) }), UUID.toLowerCase());
  assert.equal(osMachineId("win32", { run: () => { throw new Error("no reg"); } }), null);

  assert.equal(osMachineId("aix"), null, "an unsupported platform has no id, and falls back to the host name");
});

test("only a hash of the id is kept, the same for any spelling of the same id", () => {
  const hashed = machineHash(UUID);
  assert.match(hashed, /^[0-9a-f]{32}$/u);
  assert.equal(machineHash(UUID.toLowerCase()), hashed);
  assert.notEqual(machineHash(UUID.replace("0A", "0B")), hashed);
  assert.ok(!hashed.includes(UUID.toLowerCase().slice(0, 8)), "the raw id does not appear in the hash");
  assert.equal(machineHash(""), null);
  assert.equal(machineHash(null), null);
  const here = machineId();
  assert.ok(here === null || /^[0-9a-f]{32}$/u.test(here));
  assert.equal(machineId(), here, "read once per process");
});
