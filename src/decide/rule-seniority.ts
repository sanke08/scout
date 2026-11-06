/**
 * Hard rule: seniority range.
 *
 * Why: the user lists the levels they will consider (for example junior and mid). A senior or
 * lead posting is out of range.
 *
 * What it does: drops a posting whose seniority is known and not in the accepted list. An
 * `unknown` seniority is kept, and so is any posting when the user listed no levels at all.
 *
 * Example: accepted ["junior", "mid"]; a "senior" posting is dropped, a "mid" one is kept, an
 * "unknown" one is kept.
 */
import type { Posting, Profile } from "../shared/index.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** Checks the posting's seniority against the profile's accepted levels. */
export function checkSeniority(posting: Posting, profile: Profile): RuleOutcome {
  const accepted = profile.preferences.seniority;
  if (posting.seniority === "unknown" || accepted.length === 0) return NO_OBJECTION;
  if (accepted.includes(posting.seniority)) return NO_OBJECTION;
  return {
    reason: `The job is ${posting.seniority} level, and you accept only ${accepted.join(", ")}.`,
  };
}
