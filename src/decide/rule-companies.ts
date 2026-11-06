/**
 * Hard rules about who the employer is: excluded companies, excluded industries, and the
 * blacklist.
 *
 * Why: the user names employers and industries they never want. Matching is case-insensitive and
 * whole-word, so excluding "Acme" drops "ACME Corp" but not "Acmeville".
 *
 * Industries are searched in the company name, the title and the description, because a posting
 * rarely states its industry in one field. Companies and the blacklist are matched against the
 * company name only.
 *
 * Example: excludedCompanies ["Example Staffing Agency"] drops a posting from
 * "example staffing agency"; excludedIndustries ["gambling"] drops a description that says
 * "an online gambling platform".
 */
import type { Posting, Profile } from "../shared/index.js";
import { containsWholeWord } from "./text-match.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** Returns the first of `names` that appears as a whole word in `text`, or `undefined`. */
function firstWholeWordMatch(text: string, names: readonly string[]): string | undefined {
  return names.find((name) => containsWholeWord(text, name));
}

/** Drops postings from companies the user excluded in their profile. */
export function checkExcludedCompanies(posting: Posting, profile: Profile): RuleOutcome {
  const match = firstWholeWordMatch(posting.company, profile.preferences.excludedCompanies);
  if (match === undefined) return NO_OBJECTION;
  return { reason: `The company "${posting.company}" is on your excluded companies list.` };
}

/** Drops postings whose company, title or description names an industry the user excluded. */
export function checkExcludedIndustries(posting: Posting, profile: Profile): RuleOutcome {
  const text = `${posting.company}\n${posting.title}\n${posting.description}`;
  const match = firstWholeWordMatch(text, profile.preferences.excludedIndustries);
  if (match === undefined) return NO_OBJECTION;
  return { reason: `The job is in an industry you excluded ("${match}").` };
}

/** Drops postings from companies on the user's blacklist (skipped before, never wanted). */
export function checkBlacklist(posting: Posting, blacklist: readonly string[]): RuleOutcome {
  const match = firstWholeWordMatch(posting.company, blacklist);
  if (match === undefined) return NO_OBJECTION;
  return { reason: `The company "${posting.company}" is on your blacklist.` };
}
