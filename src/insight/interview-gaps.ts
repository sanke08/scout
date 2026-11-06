/**
 * Honest answers for requirements the profile does not cover.
 *
 * Why: the worst answer to "have you used X?" is a bluff. The honest answer says plainly that X
 * was not used in production, then names something real from the profile that does a similar job.
 * Every term in the answer is the gap term itself or a term the user may use, so the answer can
 * never claim a skill the profile lacks.
 */
import type { Profile } from "../shared/index.js";
import type { InterviewGap, RequirementImportance } from "./interview-types.js";
import { usableProfileTerms } from "./profile-spellings.js";
import { familyOf } from "./technology-vocabulary.js";

/** The most related terms named in one answer. */
const MAXIMUM_RELATED_TERMS = 2;

/** Joins terms for a sentence: "A", "A and B". */
function joinTerms(terms: readonly string[]): string {
  return terms.join(" and ");
}

/**
 * The user's usable terms in the same family as `term`, at most two, in profile order.
 * Example: gap "Kafka" with a skill "RabbitMQ" gives `["RabbitMQ"]` (both are messaging).
 */
export function relatedProfileTerms(term: string, profile: Profile): string[] {
  const family = familyOf(term);
  if (family === undefined) {
    return [];
  }
  return usableProfileTerms(profile)
    .filter(
      (candidate) =>
        candidate.toLowerCase() !== term.toLowerCase() && familyOf(candidate) === family,
    )
    .slice(0, MAXIMUM_RELATED_TERMS);
}

/**
 * Builds the honest answer for one gap.
 *
 * With related terms: "I have not used X in production. I have used A, which does a similar job,
 * and I can explain how I used it and what I would need to learn to work with X."
 * Without: "I have not used X in production or in a project. I would say so plainly, describe what
 * I do know from my own work, and explain how I would learn it."
 */
export function buildGap(
  term: string,
  importance: RequirementImportance,
  profile: Profile,
): InterviewGap {
  const relatedTerms = relatedProfileTerms(term, profile);
  const honestAnswer =
    relatedTerms.length > 0
      ? `I have not used ${term} in production. I have used ${joinTerms(relatedTerms)}, which does a similar job, and I can explain how I used it and what I would need to learn to work with ${term}.`
      : `I have not used ${term} in production or in a project. I would say so plainly, describe what I do know from my own work, and explain how I would learn it.`;
  return { term, importance, honestAnswer, relatedTerms };
}
