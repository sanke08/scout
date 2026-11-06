/**
 * The job store: persists jobs by posting id, merges repeat sightings, and enforces the state
 * machine. Implements `JobStore` from `src/shared/ports.ts`.
 *
 * Each job is one row: the whole `Posting` as JSON, plus separate indexed columns for status,
 * company and update time so lists stay fast. Every upsert and every transition is written to the
 * action log inside the same transaction as the change.
 *
 * Example: `store.upsertPosting(posting)` gives a `found` record; `store.transition(id,
 * "shortlisted", "score 82")` moves it and adds a log line.
 */
import { isJobStatus, postingSchema, ScoutError } from "../shared/index.js";
import type { JobFilter, JobRecord, JobStatus, JobStore, Posting } from "../shared/index.js";
import { insertLogRow } from "./action-log.js";
import type { DatabaseSync } from "./sqlite-module.js";
import { runInTransaction } from "./transaction.js";
import { assertTransitionAllowed } from "./transitions.js";

/** Statuses a job that was ever submitted can never return to (it may already have been sent). */
const REOPENING_STATUSES: readonly JobStatus[] = [
  "found",
  "shortlisted",
  "resume-ready",
  "approved",
  "skipped",
];

/** The stored columns of one job, as read back from the database. */
interface StoredJob {
  posting: Posting;
  status: JobStatus;
  previousStatus: JobStatus | undefined;
  statusReason: string | undefined;
  updatedAt: string;
}

/**
 * Merges a new sighting into the stored posting: adds sources whose url is new, keeps the union of
 * flags, and moves `lastSeenAt` forward. Everything else keeps the stored value, so a later copy of
 * the posting never rewrites what was first recorded.
 * Example: stored sources [a], incoming [a, b] gives [a, b]; flags ["repost"] + ["ghost-suspect"]
 * gives both.
 */
export function mergePostings(stored: Posting, incoming: Posting): Posting {
  const knownUrls = new Set(stored.sources.map((source) => source.url));
  const sources = [...stored.sources];
  for (const source of incoming.sources) {
    if (!knownUrls.has(source.url)) {
      knownUrls.add(source.url);
      sources.push(source);
    }
  }
  const flags = [...stored.flags];
  for (const flag of incoming.flags) {
    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }
  const lastSeenAt =
    incoming.lastSeenAt > stored.lastSeenAt ? incoming.lastSeenAt : stored.lastSeenAt;
  return { ...stored, sources, flags, lastSeenAt };
}

/** Parses the stored posting JSON; a damaged value is reported, never silently ignored. */
function parseStoredPosting(id: string, json: unknown): Posting {
  try {
    return postingSchema.parse(JSON.parse(String(json)));
  } catch {
    throw new ScoutError(
      "unavailable",
      `The stored data for job ${id} is damaged and cannot be read. Restore the database from a backup.`,
    );
  }
}

/** Reads a status column, refusing a value this version of Scout does not know. */
function parseStoredStatus(id: string, value: unknown): JobStatus {
  if (!isJobStatus(value)) {
    throw new ScoutError(
      "unavailable",
      `Job ${id} has the unknown status "${String(value)}". Restore the database from a backup.`,
    );
  }
  return value;
}

/** Turns one database row into a `StoredJob`. */
function storedJobFromRow(row: Record<string, unknown>): StoredJob {
  const id = String(row["id"]);
  const previous = row["previous_status"];
  return {
    posting: parseStoredPosting(id, row["posting_json"]),
    status: parseStoredStatus(id, row["status"]),
    previousStatus: previous === null ? undefined : parseStoredStatus(id, previous),
    statusReason: typeof row["status_reason"] === "string" ? row["status_reason"] : undefined,
    updatedAt: String(row["updated_at"]),
  };
}

/** Builds the public `JobRecord` (posting plus status) from a stored job. */
function recordFromStoredJob(stored: StoredJob): JobRecord {
  const record: JobRecord = {
    ...stored.posting,
    status: stored.status,
    updatedAt: stored.updatedAt,
  };
  if (stored.statusReason !== undefined) {
    record.statusReason = stored.statusReason;
  }
  return record;
}

/** Reads one job row, or undefined when the id is unknown. */
function readStoredJob(database: DatabaseSync, id: string): StoredJob | undefined {
  const row = database.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row === undefined ? undefined : storedJobFromRow(row);
}

/** Checks a `limit` filter and throws `ScoutError("invalid-input")` when it is not a positive whole number. */
function assertValidLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ScoutError(
      "invalid-input",
      `The job list limit must be a positive whole number, but it was ${limit}.`,
    );
  }
}

/**
 * Creates the job store over an open database. `now` gives the time of each change; tests pass a
 * fixed clock.
 * Failures: invalid posting -> `invalid-input`; unknown id in `transition` -> `not-found`; a move
 * the state machine forbids -> `illegal-transition`; damaged stored data -> `unavailable`.
 */
export function createJobStore(
  database: DatabaseSync,
  now: () => Date = () => new Date(),
): JobStore {
  /** Inserts a brand-new job as `found` and logs it. Runs inside the caller's transaction. */
  function insertNewJob(posting: Posting): void {
    const at = now().toISOString();
    database
      .prepare(
        `INSERT INTO jobs (id, status, previous_status, status_reason, company, updated_at, posting_json)
         VALUES (?, 'found', NULL, ?, ?, ?, ?)`,
      )
      .run(posting.id, "First seen.", posting.company, at, JSON.stringify(posting));
    insertLogRow(
      database,
      {
        actor: "store",
        action: "upsert",
        jobId: posting.id,
        detail: `New posting "${posting.title}" at ${posting.company} saved as found.`,
      },
      now(),
    );
  }

  /** Saves the merged posting of an existing job (status untouched) and logs it. */
  function updateExistingJob(stored: StoredJob, posting: Posting): void {
    const merged = mergePostings(stored.posting, posting);
    database
      .prepare("UPDATE jobs SET company = ?, updated_at = ?, posting_json = ? WHERE id = ?")
      .run(merged.company, now().toISOString(), JSON.stringify(merged), merged.id);
    insertLogRow(
      database,
      {
        actor: "store",
        action: "upsert",
        jobId: merged.id,
        detail: `Posting seen again; it now has ${merged.sources.length} source(s). Status stays ${stored.status}.`,
      },
      now(),
    );
  }

  return {
    upsertPosting(posting) {
      const parsed = postingSchema.safeParse(posting);
      if (!parsed.success) {
        const where = parsed.error.issues[0]?.path.join(".") ?? "posting";
        throw new ScoutError(
          "invalid-input",
          `The posting is not valid (problem at "${where}"). Fix the posting and try again.`,
        );
      }
      const valid = parsed.data;
      return runInTransaction(database, () => {
        const stored = readStoredJob(database, valid.id);
        if (stored === undefined) {
          insertNewJob(valid);
        } else {
          updateExistingJob(stored, valid);
        }
        const saved = readStoredJob(database, valid.id);
        if (saved === undefined) {
          throw new ScoutError(
            "unavailable",
            `Job ${valid.id} could not be read back after saving.`,
          );
        }
        return recordFromStoredJob(saved);
      });
    },

    get(id) {
      const stored = readStoredJob(database, id);
      return stored === undefined ? undefined : recordFromStoredJob(stored);
    },

    list(filter?: JobFilter) {
      const statuses = filter?.status === undefined ? [] : [filter.status].flat();
      if (filter?.status !== undefined && statuses.length === 0) {
        return [];
      }
      if (filter?.limit !== undefined) {
        assertValidLimit(filter.limit);
      }
      const where =
        statuses.length === 0 ? "" : `WHERE status IN (${statuses.map(() => "?").join(", ")})`;
      const limitClause = filter?.limit === undefined ? "" : "LIMIT ?";
      const values: (string | number)[] = [...statuses];
      if (filter?.limit !== undefined) {
        values.push(filter.limit);
      }
      const rows = database
        .prepare(`SELECT * FROM jobs ${where} ORDER BY updated_at DESC, id ASC ${limitClause}`)
        .all(...values);
      return rows.map((row) => recordFromStoredJob(storedJobFromRow(row)));
    },

    transition(id, to, reason) {
      if (reason.trim() === "") {
        throw new ScoutError(
          "invalid-input",
          "A status change needs a reason in plain words, but the reason was empty.",
        );
      }
      return runInTransaction(database, () => {
        const stored = readStoredJob(database, id);
        if (stored === undefined) {
          throw new ScoutError(
            "not-found",
            `No job with id ${id} exists. List jobs to see the ids that do.`,
          );
        }
        assertTransitionAllowed(stored.status, to, stored.previousStatus);
        const submittedRow = database
          .prepare("SELECT ever_submitted FROM jobs WHERE id = ?")
          .get(id);
        const everSubmitted = submittedRow?.["ever_submitted"] === 1;
        if (everSubmitted && REOPENING_STATUSES.includes(to)) {
          // A job that reached `submitting` once may have been sent. Moving it back to a status
          // before submitting (or skipping it) could let the same application be sent twice.
          throw new ScoutError(
            "illegal-transition",
            `A job cannot move from ${stored.status} to ${to} because it was already submitted once. Use withdrawn or closed instead.`,
          );
        }
        const previousToKeep = to === "needs-you" ? stored.status : null;
        database
          .prepare(
            "UPDATE jobs SET status = ?, previous_status = ?, status_reason = ?, updated_at = ?, ever_submitted = ? WHERE id = ?",
          )
          .run(
            to,
            previousToKeep,
            reason,
            now().toISOString(),
            everSubmitted || to === "submitting" ? 1 : 0,
            id,
          );
        insertLogRow(
          database,
          {
            actor: "store",
            action: "transition",
            jobId: id,
            detail: `${stored.status} -> ${to}: ${reason}`,
          },
          now(),
        );
        const saved = readStoredJob(database, id);
        if (saved === undefined) {
          throw new ScoutError("unavailable", `Job ${id} could not be read back after saving.`);
        }
        return recordFromStoredJob(saved);
      });
    },
  };
}
