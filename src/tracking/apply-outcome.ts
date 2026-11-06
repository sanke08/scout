/**
 * Moves a job's status to reflect an email, using only legal moves.
 *
 * Why it exists: a reply should update the job list, but the state machine in the store has
 * rules (for example a job cannot jump from `applied` straight to `offer`). This function asks
 * the store to make the move and, if the store refuses, reports that plainly. It never forces a
 * change and never touches anything but status.
 *
 * Example: `applyOutcome(jobStore, "job-1", "interview-invite", "Email: interview invitation")`
 * moves an `applied` job to `interviewing` and returns `{ changed: true, from: "applied", to: "interviewing" }`.
 */
import { ScoutError, type JobStatus, type JobStore } from "../shared/index.js";
import type { MessageKind } from "./message-types.js";

/** What `applyOutcome` did. */
export type OutcomeResult =
  | { changed: true; from: JobStatus; to: JobStatus; note: string }
  | {
      changed: false;
      reason: "no-status-change" | "already-there" | "illegal-transition";
      note: string;
    };

/**
 * The status each kind of message leads to, or undefined when it never changes a status.
 * A recruiter message only counts from `applied` (handled in `targetStatus`).
 */
const TARGET_BY_KIND: Partial<Record<MessageKind, JobStatus>> = {
  "interview-invite": "interviewing",
  rejection: "rejected",
  offer: "offer",
  "recruiter-message": "contacted",
};

/** Works out the status to move to, or undefined for "leave it". */
function targetStatus(kind: MessageKind, current: JobStatus): JobStatus | undefined {
  const target = TARGET_BY_KIND[kind];
  if (target === undefined) return undefined;
  if (kind === "recruiter-message" && current !== "applied") return undefined;
  return target;
}

/**
 * Applies the effect of one classified message to one job.
 *
 * - application received, assessment, other, ambiguous: no change.
 * - interview invite: `interviewing`. Rejection: `rejected`. Offer: `offer`.
 * - recruiter message: `contacted`, and only when the job is `applied`.
 * A job already at the target status is left alone. If the store says the move is illegal, the
 * result is `{ changed: false, reason: "illegal-transition" }` with the store's explanation.
 *
 * Failure: throws `ScoutError("not-found")` when the job does not exist, and rethrows any other
 * error from the store.
 */
export function applyOutcome(
  jobStore: JobStore,
  jobId: string,
  kind: MessageKind,
  reason: string,
): OutcomeResult {
  const job = jobStore.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists, so the email could not be applied.`,
    );
  }
  const target = targetStatus(kind, job.status);
  if (target === undefined) {
    return {
      changed: false,
      reason: "no-status-change",
      note: `A ${kind} message does not change the status of a job that is ${job.status}.`,
    };
  }
  if (job.status === target) {
    return { changed: false, reason: "already-there", note: `The job is already ${target}.` };
  }
  try {
    jobStore.transition(jobId, target, reason);
  } catch (error) {
    if (error instanceof ScoutError && error.code === "illegal-transition") {
      return { changed: false, reason: "illegal-transition", note: error.message };
    }
    throw error;
  }
  return {
    changed: true,
    from: job.status,
    to: target,
    note: `Moved from ${job.status} to ${target}.`,
  };
}
