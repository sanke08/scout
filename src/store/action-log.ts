/**
 * The action log: an append-only record of everything Scout did and why.
 *
 * Rows are only ever added, never changed or removed. The job store writes its own lines through
 * `insertLogRow` inside the same transaction as the job change, so a change and its log line never
 * come apart.
 *
 * Example: `log.append({ actor: "discovery", action: "fetch", detail: "12 postings" })` returns the
 * saved entry with its time; `log.recent(5)` returns the five newest, newest first.
 */
import { ScoutError } from "../shared/index.js";
import type { ActionLog, ActionLogEntry } from "../shared/index.js";
import type { DatabaseSync } from "./sqlite-module.js";

/** Writes one log row and returns the entry. Does not open a transaction; callers may wrap it. */
export function insertLogRow(
  database: DatabaseSync,
  entry: Omit<ActionLogEntry, "at">,
  at: Date,
): ActionLogEntry {
  const saved: ActionLogEntry = { at: at.toISOString(), ...entry };
  database
    .prepare("INSERT INTO action_log (at, actor, action, job_id, detail) VALUES (?, ?, ?, ?, ?)")
    .run(saved.at, saved.actor, saved.action, saved.jobId ?? null, saved.detail);
  return saved;
}

/** Turns one database row into an `ActionLogEntry`; `jobId` is left out when the row has none. */
function entryFromRow(row: Record<string, unknown>): ActionLogEntry {
  const entry: ActionLogEntry = {
    at: String(row["at"]),
    actor: String(row["actor"]),
    action: String(row["action"]),
    detail: String(row["detail"]),
  };
  if (typeof row["job_id"] === "string") {
    entry.jobId = row["job_id"];
  }
  return entry;
}

/**
 * Creates the action log over an open database. `now` gives the time stamped on each entry;
 * tests pass a fixed clock. Failure: `recent` with a limit that is not a positive whole number
 * throws `ScoutError("invalid-input")`.
 */
export function createActionLog(
  database: DatabaseSync,
  now: () => Date = () => new Date(),
): ActionLog {
  return {
    append(entry) {
      return insertLogRow(database, entry, now());
    },
    recent(limit) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new ScoutError(
          "invalid-input",
          `The number of log entries to read must be a positive whole number, but it was ${limit}.`,
        );
      }
      const rows = database
        .prepare(
          "SELECT at, actor, action, job_id, detail FROM action_log ORDER BY id DESC LIMIT ?",
        )
        .all(limit);
      return rows.map(entryFromRow);
    },
  };
}
