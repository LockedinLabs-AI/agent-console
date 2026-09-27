/** Bounded reads of small records in the owner's protected state directory. */
import fs from 'node:fs';

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const invalid = () => new Error('State file changed or is not a bounded regular file.');

export function readStateFileSync(filename, limit) {
  // Only an initially absent record is ENOENT. Disappearance after this point
  // is corruption, not permission to fall back to an initial credential.
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.size > limit) throw invalid();
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd);
    const current = fs.lstatSync(filename);
    if (!opened.isFile() || opened.size > limit || !sameFile(before, opened)
      || !current.isFile() || !sameFile(current, opened)) throw invalid();

    // A size check alone cannot bound a file that grows while it is read.
    const data = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < data.length) {
      const count = fs.readSync(fd, data, size, data.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size > limit || fs.fstatSync(fd).size > limit) throw invalid();
    return data.subarray(0, size).toString('utf8');
  } catch {
    throw invalid();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
