/**
 * Hard rule: location and remote policy.
 *
 * Why: the user lists the places they accept and whether they take remote work. A posting that
 * is on-site or hybrid somewhere else, or fully remote when the user refuses remote, cannot work.
 *
 * What it does: a `remote` posting is dropped only when the profile does not accept remote.
 * A `hybrid` or `onsite` posting is dropped when its location names none of the accepted
 * places. A posting whose remote kind is `unknown`, or whose location is empty or "unknown", is
 * never dropped: not knowing is not a reason to lose a job.
 *
 * Example: onsite in "Munich, Germany" with accepted places ["Berlin"] is dropped; the same
 * posting in "Berlin, Germany" is kept.
 */
import type { Posting, Profile } from "../shared/index.js";
import { containsWholeWord, normaliseText } from "./text-match.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** True when the posting gives no usable location. */
function locationIsUnknown(location: string): boolean {
  const text = normaliseText(location);
  return text === "" || text === "unknown";
}

/** Checks the location and remote policy of `posting` against the profile's preferences. */
export function checkLocation(posting: Posting, profile: Profile): RuleOutcome {
  const preferences = profile.preferences;
  if (posting.remote === "unknown") return NO_OBJECTION;

  if (posting.remote === "remote") {
    if (preferences.acceptsRemote) return NO_OBJECTION;
    return { reason: "The job is fully remote, and your profile does not accept remote work." };
  }

  if (locationIsUnknown(posting.location)) return NO_OBJECTION;
  for (const place of preferences.locations) {
    if (containsWholeWord(posting.location, place)) return NO_OBJECTION;
  }
  return {
    reason: `The job is ${posting.remote} in "${posting.location}", which is not one of your accepted locations.`,
  };
}
