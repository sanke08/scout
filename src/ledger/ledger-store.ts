/**
 * The ledger's tables: per-application details and the history of what happened.
 *
 * Why it exists: this is the durable record the user relies on when a call comes in. Rows are only
 * added to the history, never changed or removed; details are replaced field by field.
 *
 * Example: `store.saveDetails("abc", { recruiterName: "Sam" }, now)` then `store.getDetails("abc")`
 * gives `{ recruiterName: "Sam" }`.
 */
import type { DatabaseSync } from "../store/index.js";
import { applicationDetailsSchema } from "./types.js";
import type { ApplicationDetails, ApplicationEvent, EventKind, NewEvent } from "./types.js";

/** The columns of `application_details` and the detail field each one holds. */
const DETAIL_COLUMNS: readonly (readonly [keyof ApplicationDetails, string])[] = [
  ["externalJobId", "external_job_id"],
  ["recruiterName", "recruiter_name"],
  ["recruiterFirm", "recruiter_firm"],
  ["recruiterEmail", "recruiter_email"],
  ["recruiterPhone", "recruiter_phone"],
  ["recruiterLinkedin", "recruiter_linkedin"],
  ["appliedVia", "applied_via"],
  ["nextStep", "next_step"],
  ["nextStepDate", "next_step_date"],
];

/** Reads and writes the ledger tables. */
export interface LedgerStore {
  /** The saved details of one job, with only the fields that have a value. */
  getDetails(jobId: string): ApplicationDetails;
  /** Every job that has details, for searching. */
  allDetails(): Map<string, ApplicationDetails>;
  /** Merges `patch` into the saved details; a field set to an empty string is cleared. */
  saveDetails(jobId: string, patch: ApplicationDetails, at: Date): ApplicationDetails;
  /** Adds one history line and returns it. */
  addEvent(jobId: string, event: NewEvent & { at: string }): ApplicationEvent;
  /** The history of one job, oldest first. */
  events(jobId: string): ApplicationEvent[];
  /** The newest history time per job, for sorting. */
  lastActivity(): Map<string, string>;
  /** The time of the first `applied` line per job. */
  appliedTimes(): Map<string, string>;
  /** Job ids whose history or details mention `text` (case-insensitive). */
  searchText(text: string): Set<string>;
}

/** Turns a database row into an event. */
function eventFromRow(row: Record<string, unknown>): ApplicationEvent {
  const event: ApplicationEvent = {
    id: Number(row["id"]),
    jobId: String(row["job_id"]),
    at: String(row["at"]),
    kind: String(row["kind"]) as EventKind,
    summary: String(row["summary"]),
  };
  if (typeof row["detail"] === "string") event.detail = row["detail"];
  if (typeof row["contact"] === "string") event.contact = row["contact"];
  return event;
}

/** Turns a details row into details, leaving out empty columns. */
function detailsFromRow(row: Record<string, unknown>): ApplicationDetails {
  const details: Record<string, string> = {};
  for (const [field, column] of DETAIL_COLUMNS) {
    const value = row[column];
    if (typeof value === "string" && value.length > 0) details[field] = value;
  }
  return applicationDetailsSchema.parse(details);
}

/** Escapes `%`, `_` and the escape character so user text is matched literally by LIKE. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Creates the store over an open database whose schema is at version 3 or newer. */
export function createLedgerStore(database: DatabaseSync): LedgerStore {
  return {
    getDetails(jobId) {
      const row = database.prepare("SELECT * FROM application_details WHERE job_id = ?").get(jobId);
      return row === undefined ? {} : detailsFromRow(row);
    },
    allDetails() {
      const result = new Map<string, ApplicationDetails>();
      for (const row of database.prepare("SELECT * FROM application_details").all()) {
        result.set(String(row["job_id"]), detailsFromRow(row));
      }
      return result;
    },
    saveDetails(jobId, patch, at) {
      const merged: Record<string, string> = { ...this.getDetails(jobId) };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (value === "") delete merged[field];
        else merged[field] = value;
      }
      const columns = DETAIL_COLUMNS.map(([, column]) => column);
      const values = DETAIL_COLUMNS.map(([field]) => merged[field] ?? null);
      database
        .prepare(
          `INSERT OR REPLACE INTO application_details (job_id, ${columns.join(", ")}, updated_at)
           VALUES (?, ${columns.map(() => "?").join(", ")}, ?)`,
        )
        .run(jobId, ...values, at.toISOString());
      return applicationDetailsSchema.parse(merged);
    },
    addEvent(jobId, event) {
      const result = database
        .prepare(
          "INSERT INTO application_events (job_id, at, kind, summary, detail, contact) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          jobId,
          event.at,
          event.kind,
          event.summary,
          event.detail ?? null,
          event.contact ?? null,
        );
      const saved: ApplicationEvent = {
        id: Number(result.lastInsertRowid),
        jobId,
        at: event.at,
        kind: event.kind,
        summary: event.summary,
      };
      if (event.detail !== undefined) saved.detail = event.detail;
      if (event.contact !== undefined) saved.contact = event.contact;
      return saved;
    },
    events(jobId) {
      return database
        .prepare("SELECT * FROM application_events WHERE job_id = ? ORDER BY at ASC, id ASC")
        .all(jobId)
        .map(eventFromRow);
    },
    lastActivity() {
      const result = new Map<string, string>();
      for (const row of database
        .prepare("SELECT job_id, MAX(at) AS last FROM application_events GROUP BY job_id")
        .all()) {
        result.set(String(row["job_id"]), String(row["last"]));
      }
      return result;
    },
    appliedTimes() {
      const result = new Map<string, string>();
      for (const row of database
        .prepare(
          "SELECT job_id, MIN(at) AS first FROM application_events WHERE kind = 'applied' GROUP BY job_id",
        )
        .all()) {
        result.set(String(row["job_id"]), String(row["first"]));
      }
      return result;
    },
    searchText(text) {
      const pattern = likePattern(text);
      const ids = new Set<string>();
      for (const row of database
        .prepare(
          `SELECT DISTINCT job_id FROM application_events
           WHERE summary LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\'`,
        )
        .all(pattern, pattern, pattern)) {
        ids.add(String(row["job_id"]));
      }
      return ids;
    },
  };
}
