/*
 * Loaded with --import by test/program-lookup.test.js, ahead of an entry
 * point. Every child_process function is replaced: a call writes one JSON
 * line to the file named by RECORD_PROGRAMS (the function, the program, and
 * NoDefaultCurrentDirectoryInExePath as it stood) and ends the process, so no
 * program is ever started. This module must not set the variable itself.
 */

import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const log = process.env.RECORD_PROGRAMS;
if (!log) throw new Error("RECORD_PROGRAMS names no file");

for (const call of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
  childProcess[call] = (file) => {
    const variable = process.env.NoDefaultCurrentDirectoryInExePath ?? null;
    fs.appendFileSync(log, JSON.stringify({ call, file: String(file), variable }) + "\n");
    process.exit(0);
  };
}
syncBuiltinESMExports();

// An entry point imports these by name; refuse to go on unless it gets the replacements.
const named = await import("node:child_process");
if (named.execFile !== childProcess.execFile || named.spawn !== childProcess.spawn) {
  throw new Error("child_process could not be replaced; nothing was started");
}
