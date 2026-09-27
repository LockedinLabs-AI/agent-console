/*
 * Path checks for the scripts the release pipeline runs. Their arguments are
 * written in the workflows, but a script that opens a path or writes one must
 * not follow it outside the place it was meant for: a symbolic link planted in
 * a downloaded artifact, or a mistyped argument, fails here before anything is
 * read, published or overwritten.
 */

import fs from "node:fs";
import path from "node:path";

function plain(value, what) {
  if (typeof value !== "string" || value === "" || value.includes("\0")) throw new Error(`${what} must be a path.`);
  return value;
}

/** The real path of `candidate`, which must exist strictly inside `root` (default: the working directory). */
export function insideRoot(candidate, { root = process.cwd(), what = "path" } = {}) {
  const realRoot = fs.realpathSync(root);
  let real;
  try {
    real = fs.realpathSync(path.resolve(realRoot, plain(candidate, what)));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${what} does not exist: ${candidate}`);
    throw error;
  }
  const relative = path.relative(realRoot, real);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${what} must be inside ${realRoot}: ${candidate}`);
  }
  return real;
}

/** `candidate` resolved, which must be a regular file (never a link) whose name matches `name`. */
export function namedRegularFile(candidate, name, { what = "file" } = {}) {
  const file = path.resolve(plain(candidate, what));
  if (!name.test(path.basename(file))) throw new Error(`${what} has an unexpected name: ${path.basename(file)}`);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${what} does not exist: ${candidate}`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${what} must be a regular file, not a link or folder: ${candidate}`);
  return file;
}
