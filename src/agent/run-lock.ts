/**
 * The lock that lets only one autopilot run work on a data folder at a time, across processes.
 *
 * Why it exists: the web page and `scout agent run` each have their own controller, and a flag in
 * memory cannot see the other one. The lock is the file `<data>/agent-runs/run.lock` holding the
 * process id and start time. It is created exclusively (it fails when it exists), so two starters
 * cannot both win. A lock whose process no longer exists is stale (left by a crash) and is taken
 * over.
 *
 * Example: `const lock = acquireRunLock(folder, now)` returns a lock to `release()` when the run
 * ends, or throws a ScoutError that says who holds it.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScoutError } from "../shared/index.js";

/** The name of the lock file inside the runs folder. */
export const RUN_LOCK_FILE_NAME = "run.lock";

/** A lock held by this process. */
export interface RunLock {
  /** Removes the lock file. Safe to call twice. */
  release(): void;
}

/** What the lock file holds. */
interface LockContents {
  pid: number;
  startedAt: string;
}

/** True when a process with this id exists (permission denied still means it exists). */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Reads the lock file; undefined when it is missing or damaged (a damaged lock counts as stale). */
function readLock(path: string): LockContents | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockContents>;
    if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") {
      return { pid: parsed.pid, startedAt: parsed.startedAt };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Takes the lock or throws. `startedAt` is an ISO time for the message.
 * Failure: `ScoutError("invalid-input")` when another live process holds it.
 */
export function acquireRunLock(runsDirectory: string, startedAt: string): RunLock {
  mkdirSync(runsDirectory, { recursive: true });
  const path = join(runsDirectory, RUN_LOCK_FILE_NAME);
  const contents: LockContents = { pid: process.pid, startedAt };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, JSON.stringify(contents), { flag: "wx", mode: 0o600 });
      return {
        release() {
          if (readLock(path)?.pid !== process.pid) return;
          try {
            unlinkSync(path);
          } catch {
            // Already gone: nothing to release.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readLock(path);
    if (holder !== undefined && processIsAlive(holder.pid)) {
      throw new ScoutError(
        "invalid-input",
        `Another autopilot run is already going (process ${holder.pid}, started ${holder.startedAt}). Wait for it to finish or stop it there first.`,
      );
    }
    try {
      unlinkSync(path);
    } catch {
      // Someone else removed the stale lock first; the next attempt creates it.
    }
  }
  throw new ScoutError(
    "invalid-input",
    "Another autopilot run is starting at this moment. Try again in a few seconds.",
  );
}
