/**
 * Hard rule: dealbreaker phrases.
 *
 * Why: the user writes down things they will not accept ("on-call every week"). If the posting
 * says one of them, it is out.
 *
 * What it does: searches the title and description for each dealbreaker as plain text, ignoring
 * case and extra spaces. Empty dealbreakers are ignored.
 *
 * Example: dealbreaker "unpaid trial work" and a description containing "Includes unpaid trial
 * work for two weeks" is dropped.
 */
import type { Posting, Profile } from "../shared/index.js";
import { containsPhrase } from "./text-match.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** Checks the posting text for any dealbreaker phrase. */
export function checkDealbreakers(posting: Posting, profile: Profile): RuleOutcome {
  const text = `${posting.title}\n${posting.description}`;
  const found = profile.preferences.dealbreakers.find((phrase) => containsPhrase(text, phrase));
  if (found === undefined) return NO_OBJECTION;
  return { reason: `The posting mentions your dealbreaker "${found}".` };
}
