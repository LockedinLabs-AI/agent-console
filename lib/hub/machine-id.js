/**
 * A stable identity for this computer, to tell a lock this computer left
 * behind from one another computer holds on a shared folder.
 *
 * The host name is not stable enough for that: macOS takes a laptop's host
 * name from the network it joined, so the name changes as the machine moves,
 * and a console that stopped abruptly on one network could not recognise its
 * own lock on the next. The
 * operating system's machine id does not change with the network. Only a
 * hash of it is kept, so the raw id never reaches a file.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const HEX32 = /^[0-9a-f]{32}$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The operating system's own machine id, or null where it cannot be read. */
export function osMachineId(platform = process.platform, { run = spawnSync, readFile = fs.readFileSync } = {}) {
  try {
    if (platform === "linux") {
      for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          const value = String(readFile(file, "utf8")).trim();
          if (HEX32.test(value)) return value;
        } catch { /* try the next one */ }
      }
      return null;
    }
    if (platform === "darwin") {
      const answer = run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 3000 });
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/u.exec(String(answer?.stdout || ""));
      return match && UUID.test(match[1]) ? match[1] : null;
    }
    if (platform === "win32") {
      const answer = run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 3000, windowsHide: true });
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/u.exec(String(answer?.stdout || ""));
      return match && UUID.test(match[1]) ? match[1] : null;
    }
  } catch { /* unavailable */ }
  return null;
}

/** 32 hex characters derived from a raw machine id, or null. */
export function machineHash(raw) {
  if (typeof raw !== "string" || !raw) return null;
  return crypto.createHash("sha256").update("agent-console machine v1\n" + raw.toLowerCase()).digest("hex").slice(0, 32);
}

let cached;

/** This computer's hashed machine id (read once per process), or null. */
export function machineId() {
  if (cached === undefined) cached = machineHash(osMachineId());
  return cached;
}
