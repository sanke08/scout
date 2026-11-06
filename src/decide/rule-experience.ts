/**
 * Hard rule: years of experience required.
 *
 * Why: a posting that asks for "5-7 years" is out of reach for someone with two. The user's
 * profile keeps full-time months and internship months apart, so this rule must not mix them up.
 *
 * What it does:
 * 1. Reads every "N years" or "N-M years" or "N+ years" phrase that sits in a sentence mentioning
 *    "experience". For a range it takes the lower number. When a posting states several, it takes
 *    the SMALLEST (the most lenient reading, so a skill-specific "2 years of Kafka" next to a
 *    "5+ years overall" never causes a wrong drop).
 * 2. Compares it with the user's FULL-TIME months only. Internship months are ignored on purpose:
 *    Scout cannot tell whether an internship overlapped a job, and counting overlapping months
 *    twice is forbidden. Ignoring them is the documented, stricter-but-honest rule.
 * 3. Allows a tolerance of 12 months, because employers rarely enforce the number to the month.
 *    The posting is dropped only when required months minus 12 still exceed the user's
 *    full-time months.
 *
 * A posting that states no requirement is kept.
 *
 * Example: description "3+ years of experience", full-time 28 months: kept (36 - 12 = 24 <= 28).
 * Description "5-7 years of experience", full-time 28 months: dropped (60 - 12 = 48 > 28).
 */
import type { Posting, Profile } from "../shared/index.js";
import { normaliseText } from "./text-match.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";

/** Months of shortfall the rule forgives. */
export const EXPERIENCE_TOLERANCE_MONTHS = 12;

/** Matches "3 years", "3+ years", "5-7 years", "5 to 7 years", "5 – 7 yrs". */
const YEARS_PATTERN = /(\d{1,2})\s*\+?\s*(?:(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b/g;

/** Splits text into rough sentences so "experience" must sit near the number. */
function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/);
}

/**
 * Returns the smallest required number of years found in `description`, or `undefined` when it
 * states none. Only sentences that also contain the word "experience" count.
 *
 * Example: `requiredYears("You have 5-7 years of experience in Go.")` is `5`;
 * `requiredYears("We are 10 years old.")` is `undefined`.
 */
export function requiredYears(description: string): number | undefined {
  let smallest: number | undefined;
  for (const sentence of splitIntoSentences(normaliseText(description))) {
    if (!sentence.includes("experience")) continue;
    for (const match of sentence.matchAll(YEARS_PATTERN)) {
      const years = Number(match[1]);
      if (smallest === undefined || years < smallest) smallest = years;
    }
  }
  return smallest;
}

/** Checks the years of experience the posting asks for against the user's full-time months. */
export function checkExperience(posting: Posting, profile: Profile): RuleOutcome {
  const years = requiredYears(posting.description);
  if (years === undefined) return NO_OBJECTION;

  const requiredMonths = years * 12;
  const haveMonths = profile.preferences.experienceMonths.fullTime;
  if (requiredMonths - EXPERIENCE_TOLERANCE_MONTHS <= haveMonths) return NO_OBJECTION;
  return {
    reason: `The job asks for ${years} years of experience, and you have ${haveMonths} months of full-time work.`,
  };
}
