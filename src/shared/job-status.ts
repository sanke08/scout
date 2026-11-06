/**
 * The one list of job statuses for the whole system (Scout idea document, section 5.11).
 *
 * Every module imports this list. Nothing else may define a status name, so a job can never be
 * in a state that another module does not know about.
 *
 * Example: `isJobStatus("applied")` is `true`; `isJobStatus("submitted")` is `false`.
 */

/** Statuses a job moves through in normal life, in order. */
export const MAIN_JOB_STATUSES = [
  "found",
  "shortlisted",
  "resume-ready",
  "approved",
  "submitting",
  "applied",
  "contacted",
  "interviewing",
  "offer",
  "rejected",
] as const;

/**
 * Side statuses a job can be put in from several places.
 * - `skipped`: the user or a rule decided not to pursue it.
 * - `needs-you`: a person must act or decide (a code, a login, an unknown question).
 * - `unverified`: a submit that could not be proven (no confirmation seen).
 * - `failed`: a step failed and will not be retried automatically.
 * - `closed`: the posting no longer accepts applications.
 * - `withdrawn`: the user withdrew the application.
 */
export const SIDE_JOB_STATUSES = [
  "skipped",
  "needs-you",
  "unverified",
  "failed",
  "closed",
  "withdrawn",
] as const;

/** Every valid status. */
export const JOB_STATUSES = [...MAIN_JOB_STATUSES, ...SIDE_JOB_STATUSES] as const;

/** Type of one job status, for example `"found"` or `"needs-you"`. */
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Returns true when `value` is one of the known job statuses. */
export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}
