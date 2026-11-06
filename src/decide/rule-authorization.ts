/**
 * Hard rule: work authorization.
 *
 * Why: some postings say outright that only citizens, or people holding a clearance, may apply.
 * If the profile lists no matching authorization, applying would waste everyone's time.
 *
 * What it does: looks for a short list of well-known phrases in the description. Each phrase
 * belongs to a requirement with keywords. The posting is dropped when a phrase is present and no
 * entry in `profile.preferences.workAuthorization` contains one of the requirement's keywords
 * as a whole word. Postings without such phrases are kept.
 *
 * Example: description "You must be a US citizen" with authorization ["EU"] is dropped; with
 * authorization ["US citizen"] it is kept.
 */
import type { Posting, Profile } from "../shared/index.js";
import { containsPhrase, containsWholeWord } from "./text-match.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** One kind of authorization requirement a posting can state. */
interface AuthorizationRequirement {
  /** Plain name used in the reason, for example "US citizenship". */
  name: string;
  /** Phrases that state the requirement. */
  phrases: readonly string[];
  /** Words that, in a profile authorization entry, show the user meets it. */
  matchingKeywords: readonly string[];
}

/** The requirements Scout recognises. Kept short on purpose: false drops cost real jobs. */
const REQUIREMENTS: readonly AuthorizationRequirement[] = [
  {
    name: "US citizenship",
    phrases: [
      "must be a us citizen",
      "us citizenship required",
      "us citizens only",
      "must be a united states citizen",
    ],
    matchingKeywords: ["us", "usa", "united states"],
  },
  {
    name: "a security clearance",
    phrases: [
      "security clearance required",
      "must hold a security clearance",
      "must have an active security clearance",
      "active security clearance",
    ],
    matchingKeywords: ["clearance"],
  },
  {
    name: "the right to work in the UK",
    phrases: ["must have the right to work in the uk", "uk right to work required"],
    matchingKeywords: ["uk", "united kingdom"],
  },
];

/** True when some authorization the user listed contains one of `keywords`. */
function userHoldsAnyOf(authorizations: readonly string[], keywords: readonly string[]): boolean {
  return authorizations.some((entry) =>
    keywords.some((keyword) => containsWholeWord(entry, keyword)),
  );
}

/** Checks the posting's authorization requirements against the profile's authorizations. */
export function checkWorkAuthorization(posting: Posting, profile: Profile): RuleOutcome {
  for (const requirement of REQUIREMENTS) {
    const stated = requirement.phrases.some((phrase) =>
      containsPhrase(posting.description, phrase),
    );
    if (!stated) continue;
    if (userHoldsAnyOf(profile.preferences.workAuthorization, requirement.matchingKeywords))
      continue;
    return {
      reason: `The job requires ${requirement.name}, and your profile lists no matching work authorization.`,
    };
  }
  return NO_OBJECTION;
}
