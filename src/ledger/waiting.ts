/**
 * Moving a job back out of `needs-you`, to the status it came from.
 *
 * Why it exists: the state machine lets a `needs-you` job return only to where it came from, but
 * the job store does not hand that status out. A job whose filled form is waiting for the owner
 * (see `WAITING_FOR_SUBMIT_REASON`) can have come from `shortlisted`, `resume-ready` or `approved`;
 * the apply helper and the ledger both need to put it back before the next legal steps. Each try
 * is a normal, checked transition; the store refuses the wrong origins.
 *
 * Example: a job that was `resume-ready` before it needed the owner returns to `resume-ready`.
 */
import { ScoutError } from "../shared/index.js";
import type { JobStatus, JobStore } from "../shared/index.js";

/** The places a job waiting for the owner's submit can have come from, most advanced last. */
const ORIGINS: readonly JobStatus[] = ["resume-ready", "approved", "shortlisted"];

/**
 * Moves a `needs-you` job back to its origin and returns that status.
 * Failure: `illegal-transition` when the job did not come from any of the known origins.
 */
export function returnFromNeedsYou(jobStore: JobStore, jobId: string, reason: string): JobStatus {
  for (const origin of ORIGINS) {
    try {
      jobStore.transition(jobId, origin, reason);
      return origin;
    } catch (error) {
      if (!(error instanceof ScoutError) || error.code !== "illegal-transition") throw error;
    }
  }
  throw new ScoutError(
    "illegal-transition",
    `Job ${jobId} cannot be put back to where it came from, so Scout leaves it as it is. Use \`scout undo ${jobId}\` or ask the owner.`,
  );
}
