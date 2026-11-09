/**
 * Runs a piece of work as one SQLite transaction.
 *
 * Why it exists: a job change and its action-log line must be saved together or not at all. Node's
 * SQLite has no transaction helper, so this one does BEGIN, COMMIT and ROLLBACK explicitly.
 *
 * Example: `runInTransaction(database, () => { update(); log(); })` keeps both or neither.
 * Failure: if the work throws, everything it wrote is undone and the same error is rethrown.
 *
 * Nesting: work that runs inside another `runInTransaction` on the same database joins it (SQLite
 * cannot nest a BEGIN). An outer step that must be atomic, such as "check the daily limit and move
 * the job to submitting", can therefore call the job store, which opens its own transaction.
 */
import type { DatabaseSync } from "./sqlite-module.js";

/** The databases that currently have a transaction open from this module. */
const OPEN_TRANSACTIONS = new WeakSet<DatabaseSync>();

/** Runs `work` inside BEGIN IMMEDIATE ... COMMIT; rolls back and rethrows if `work` throws. */
export function runInTransaction<Result>(database: DatabaseSync, work: () => Result): Result {
  if (OPEN_TRANSACTIONS.has(database)) return work();
  database.exec("BEGIN IMMEDIATE");
  OPEN_TRANSACTIONS.add(database);
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    OPEN_TRANSACTIONS.delete(database);
  }
}
