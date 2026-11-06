/**
 * Atomic file writes: a file is either the old version or the whole new version, never half.
 *
 * Why it exists: a crash or power cut in the middle of a write must not leave a damaged job
 * record or backup file. We write to a temporary file beside the target, then rename it over the
 * target; a rename on one disk is atomic.
 *
 * Example: `writeTextAtomic("/data/jobs/x/job.md", "text")` leaves only `job.md` behind.
 * Failure: if the write or rename fails, the temporary file is removed and the original error is
 * thrown; the target keeps its old content.
 */
import { copyFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Counter that keeps two temporary names made in the same millisecond different. */
let temporaryCounter = 0;

/** Makes a temporary path beside `target`, such as `/dir/.job.md.tmp-1234-1`. */
function temporaryPathFor(target: string): string {
  temporaryCounter += 1;
  return join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${temporaryCounter}`);
}

/** Runs `fill` to create the temporary file, then renames it onto `target`; cleans up on error. */
function replaceAtomically(target: string, fill: (temporaryPath: string) => void): void {
  const temporaryPath = temporaryPathFor(target);
  try {
    fill(temporaryPath);
    renameSync(temporaryPath, target);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Writes `text` (UTF-8) to `target` atomically. */
export function writeTextAtomic(target: string, text: string): void {
  replaceAtomically(target, (temporaryPath) => writeFileSync(temporaryPath, text, "utf8"));
}

/** Copies the file `source` to `target` atomically. */
export function copyFileAtomic(source: string, target: string): void {
  replaceAtomically(target, (temporaryPath) => copyFileSync(source, temporaryPath));
}
