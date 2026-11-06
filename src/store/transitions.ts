/**
 * The job state machine: the one table of which status may follow which.
 *
 * Why it exists: Scout acts on the user's behalf, so a job must never jump to a state it should not
 * be in. The most important rules:
 * - `applied` is reachable only from `submitting`, so "applied" always means a submit was done.
 * - `submitting` is the idempotent submit marker. It is left only by `applied`, `unverified`,
 *   `needs-you` or `failed`; never back to `approved`, so an interrupted submit is never retried
 *   blindly.
 * - A job that was submitted (`applied` and everything after it, and `unverified`) can never be
 *   `skipped`: `skipped` can return to `found`, which would let an already-sent application be
 *   sent twice. Use `withdrawn` or `closed` for those instead.
 * - Every status before `submitting` may go to `skipped` or `closed`.
 * - `needs-you` remembers where the job came from and may return there (see `allowedNextStatuses`).
 *
 * Example: `allowedNextStatuses("approved", undefined)` includes `"submitting"` but not `"applied"`.
 */
import { ScoutError } from "../shared/index.js";
import type { JobStatus } from "../shared/index.js";

/**
 * For each status, the statuses a job may move to next. Written out in full on purpose: one table,
 * easy to read and to review. `needs-you` lists only its fixed exits; its way back to the previous
 * status is added by `allowedNextStatuses`.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  found: ["shortlisted", "needs-you", "failed", "skipped", "closed"],
  shortlisted: ["resume-ready", "approved", "needs-you", "failed", "skipped", "closed"],
  "resume-ready": ["approved", "needs-you", "failed", "skipped", "closed"],
  approved: [
    "submitting",
    "resume-ready",
    "shortlisted",
    "needs-you",
    "failed",
    "skipped",
    "closed",
  ],
  submitting: ["applied", "unverified", "needs-you", "failed"],
  applied: ["contacted", "interviewing", "rejected", "withdrawn", "closed"],
  contacted: ["interviewing", "offer", "rejected", "withdrawn", "closed"],
  interviewing: ["offer", "rejected", "withdrawn", "closed"],
  offer: ["rejected", "withdrawn", "closed"],
  rejected: [],
  skipped: ["found", "shortlisted", "closed"],
  "needs-you": ["skipped", "closed", "failed"],
  unverified: [
    "contacted",
    "interviewing",
    "offer",
    "rejected",
    "withdrawn",
    "needs-you",
    "failed",
    "closed",
  ],
  failed: ["skipped", "closed"],
  closed: [],
  withdrawn: [],
};

/** Statuses a job can never leave. Example: a `rejected` job stays `rejected`. */
export const TERMINAL_STATUSES: readonly JobStatus[] = ["rejected", "closed", "withdrawn"];

/**
 * The statuses a job may move to from `from`. For a job in `needs-you`, `previousStatus` (where it
 * came from) is added, so the job can resume exactly where it paused. Example:
 * `allowedNextStatuses("needs-you", "approved")` includes `"approved"`.
 */
export function allowedNextStatuses(
  from: JobStatus,
  previousStatus: JobStatus | undefined,
): JobStatus[] {
  const allowed = [...ALLOWED_TRANSITIONS[from]];
  if (from === "needs-you" && previousStatus !== undefined && !allowed.includes(previousStatus)) {
    allowed.unshift(previousStatus);
  }
  return allowed;
}

/**
 * Throws `ScoutError("illegal-transition")` unless `from` may move to `to`. The message names both
 * statuses and the allowed next ones. Example: `assertTransitionAllowed("found", "applied", undefined)`
 * throws "A job cannot move from found to applied. Allowed next statuses: shortlisted, ...".
 */
export function assertTransitionAllowed(
  from: JobStatus,
  to: JobStatus,
  previousStatus: JobStatus | undefined,
): void {
  const allowed = allowedNextStatuses(from, previousStatus);
  if (allowed.includes(to)) {
    return;
  }
  const choices = allowed.length === 0 ? "none (this status is final)" : allowed.join(", ");
  throw new ScoutError(
    "illegal-transition",
    `A job cannot move from ${from} to ${to}. Allowed next statuses: ${choices}.`,
  );
}
