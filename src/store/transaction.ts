/**
 * Runs a piece of work as one SQLite transaction.
 *
 * Why it exists: a job change and its action-log line must be saved together or not at all. Node's
 * SQLite has no transaction helper, so this one does BEGIN, COMMIT and ROLLBACK explicitly.
 *
 * Example: `runInTransaction(database, () => { update(); log(); })` keeps both or neither.
 * Failure: if the work throws, everything it wrote is undone and the same error is rethrown.
 */
import type { DatabaseSync } from "./sqlite-module.js";

/** Runs `work` inside BEGIN IMMEDIATE ... COMMIT; rolls back and rethrows if `work` throws. */
export function runInTransaction<Result>(database: DatabaseSync, work: () => Result): Result {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
