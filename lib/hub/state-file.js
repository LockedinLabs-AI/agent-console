/** Bounded reads of small records in the owner's protected state directory. */
import fs from 'node:fs';

// O_NOFOLLOW refuses a symlinked record and O_NONBLOCK keeps a FIFO from
// stalling the open. Windows has neither; the checks after opening cover it.
const READ_ONLY = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
// Device and inode stay BigInts: a 64-bit file ID (NTFS keeps a sequence
// number in its top bits) does not survive conversion to Number.
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const invalid = () => new Error('State file changed or is not a bounded regular file.');

function whollyAbsent(filename) {
  try { fs.lstatSync(filename); return false; } catch (error) { return error.code === 'ENOENT'; }
}

/**
 * The record is identified by the descriptor it is read from, never by an
 * earlier look at the path: open first, inspect the descriptor, then require
 * that the path still names exactly that regular file.
 */
export function readStateFileSync(filename, limit) {
  const bound = BigInt(limit);
  let fd;
  try {
    fd = fs.openSync(filename, READ_ONLY);
  } catch (error) {
    // Only a name that is wholly absent is an initial state. A dangling link
    // (which Windows follows at open) is not, and neither is a name that
    // appears while this is decided.
    if (error.code === 'ENOENT' && whollyAbsent(filename)) throw error;
    throw invalid();
  }
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.size > bound) throw invalid();
    // Disappearance or replacement after opening is corruption, not
    // permission to fall back to an initial credential.
    const current = fs.lstatSync(filename, { bigint: true });
    if (!current.isFile() || !sameFile(current, opened)) throw invalid();

    // A size check alone cannot bound a file that grows while it is read.
    const data = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < data.length) {
      const count = fs.readSync(fd, data, size, data.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size > limit || fs.fstatSync(fd, { bigint: true }).size > bound) throw invalid();
    return data.subarray(0, size).toString('utf8');
  } catch {
    throw invalid();
  } finally {
    fs.closeSync(fd);
  }
}
