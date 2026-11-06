/**
 * Hard rule: posting flags set by discovery.
 *
 * Why: discovery marks suspicious postings. A `scam-suspect` posting (fee requests, contact only
 * through a messaging app) must never be applied to, so it always drops. A `ghost-suspect`
 * posting (long open, repeatedly reposted) may still be real, so it is kept and only reported.
 *
 * Example: flags ["scam-suspect"] drops; flags ["ghost-suspect"] keeps with a note.
 */
import type { Posting } from "../shared/index.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** The flag that always drops a posting. */
export const SCAM_FLAG = "scam-suspect";

/** The flag that is reported but never drops a posting. */
export const GHOST_FLAG = "ghost-suspect";

/** Turns the discovery flags of `posting` into a drop reason or a note. */
export function checkFlags(posting: Posting): RuleOutcome {
  if (posting.flags.includes(SCAM_FLAG)) {
    return {
      reason: "The posting looks like a scam (discovery flagged it), so Scout never applies to it.",
    };
  }
  if (posting.flags.includes(GHOST_FLAG)) {
    return { note: "The posting may be a ghost job (open a long time or reposted); it was kept." };
  }
  return NO_OBJECTION;
}
