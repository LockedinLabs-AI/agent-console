/**
 * Helper programs come from PATH, and only from PATH.
 *
 * The console starts a few programs by name: git in the repositories that
 * sessions worked in, the browser opener and the desktop notifier when asked,
 * and, outside Windows, the reporter's `ps`. Windows looks for a program named
 * without a folder in the working folder before PATH, unless the environment
 * variable NoDefaultCurrentDirectoryInExePath exists; Node's process library
 * honours it from libuv 1.48, which every Node.js this package supports ships,
 * and so does cmd.exe. Importing this module sets it. Each entry point imports
 * it before anything else, and so does every module that starts a program, so
 * it is set before anything can start one. Only Windows reads it; elsewhere it
 * changes nothing.
 *
 * On Windows each program is also named by its full path, so what runs does
 * not rest on that lookup alone: git as PATH finds it (programOnPath), cmd and
 * PowerShell from the Windows system folder (systemProgram).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** While this variable exists, Windows program lookup leaves out the working folder. */
export const PATH_ONLY = "NoDefaultCurrentDirectoryInExePath";

/** Sets PATH_ONLY in `env` (this process's environment unless given) and returns `env`. */
export function searchPathOnly(env = process.env) {
  env[PATH_ONLY] = "1";
  return env;
}

searchPathOnly();

/** What Windows starts without a shell, in the order libuv tries it. */
const RUNNABLE = [".com", ".exe"];

/**
 * A variable's value, whatever the case of its name, as Windows reads it.
 * Given two spellings, the first in sort order: the one Node passes a child.
 */
function variable(env, name) {
  const key = Object.keys(env).filter((k) => k.toUpperCase() === name).sort()[0];
  return key === undefined || env[key] === undefined ? "" : String(env[key]);
}

/** A folder named in full: a drive and its root (C:\…) or a network share (\\host\…). */
const fullPath = (dir) => /^[A-Za-z]:[\\/]/u.test(dir) || /^[\\/]{2}[^\\/]/u.test(dir);

const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const realPath = (file) => { try { return fs.realpathSync.native(file); } catch { return file; } };

/** True when `file` is `folder` or anything beneath it, compared as Windows compares paths. */
function within(folder, file) {
  const rel = path.win32.relative(folder, file);
  return !(rel === ".." || rel.startsWith("..\\") || path.win32.isAbsolute(rel));
}

/**
 * The full path of the program `name` that PATH finds on Windows, for a
 * program that will run in `cwd`. Never one in or beneath that folder, by
 * spelling or by its real path (a link or a short name into it), and never
 * one found through a PATH entry that is not a full path, since Windows reads
 * those from the working folder. Null when PATH has no other. Elsewhere
 * `name` comes back as given: the system looks only on PATH there.
 * Native clients may set excludeDescendants=false to permit installations
 * in explicit PATH subdirectories of their home. The working directory
 * itself, including aliases into it, remains excluded in that mode.
 */
export function programOnPath(name, { cwd = process.cwd(), env = process.env, platform = process.platform,
  exists = isFile, real = realPath, excludeDescendants = true } = {}) {
  if (platform !== "win32") return name;
  const folder = path.win32.resolve(cwd);
  const realFolder = real(folder);
  const excluded = (root, dir) => excludeDescendants ? within(root, dir)
    : path.win32.relative(root, dir) === '';
  const files = /\.(?:com|exe)$/iu.test(name) ? [name] : RUNNABLE.map((extension) => name + extension);
  for (const entry of variable(env, "PATH").split(";")) {
    const dir = entry.replace(/^"|"$/gu, "");
    if (!fullPath(dir) || excluded(folder, dir)) continue;
    for (const file of files) {
      const candidate = path.win32.join(dir, file);
      if (exists(candidate) && !excluded(realFolder, path.win32.dirname(real(candidate)))) return candidate;
    }
  }
  return null;
}

/**
 * A program that comes with Windows, by its full path in the system folder
 * (%SystemRoot%\System32). Null when SystemRoot does not name a folder in full.
 */
export function systemProgram(relative, { env = process.env } = {}) {
  const root = variable(env, "SYSTEMROOT");
  return fullPath(root) ? path.win32.join(root, "System32", relative) : null;
}
