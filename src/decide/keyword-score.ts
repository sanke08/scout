/**
 * Keyword ranking: how well a posting's words match the profile's terms, 0 to 100, with no model.
 *
 * Why: scenario D ranks the postings that survive the hard rules before any model is paid for.
 *
 * Formula (deterministic):
 * - Skill coverage = the share of the posting's named skills that match a profile term.
 * - Description signal = distinct profile terms found in the title and description, as a share of
 *   `DESCRIPTION_TERMS_FOR_FULL_SIGNAL` (so five different matches is as good as it gets).
 * - When the posting names skills: score = 70 * skill coverage + 30 * description signal.
 *   Skills the posting names count more than words that merely appear in the text.
 * - When it names none: score = 100 * description signal.
 * Missing terms are never penalised on their own; they only fail to raise the score.
 *
 * Terms of one or two letters ("go", "c", "r") are matched only against the named skills, never
 * in running text, because in a description "go" is far more often an ordinary English word.
 *
 * Example: a posting naming ["Node.js", "Kafka"] for a profile holding both scores 70 plus a
 * description share; a posting naming ["COBOL"] scores 0 from skills.
 */
import type { Posting, Profile } from "../shared/index.js";
import { termsOfProfile } from "./profile-terms.js";
import { containsWholeWord, normaliseText } from "./text-match.js";

/** Weight of the posting's named skills when it names any. */
export const SKILL_WEIGHT = 70;

/** Weight of the words found in the description when the posting also names skills. */
export const DESCRIPTION_WEIGHT = 30;

/** How many different profile terms in the description give the full description signal. */
export const DESCRIPTION_TERMS_FOR_FULL_SIGNAL = 5;

/** Terms this short are only matched in named skills. */
const SHORT_TERM_LENGTH = 2;

/** True when the posting skill `skill` is, or contains as a whole word, a profile term. */
function skillMatchesProfile(skill: string, terms: readonly string[]): boolean {
  const normalised = normaliseText(skill);
  return terms.some((term) => term === normalised || containsWholeWord(normalised, term));
}

/** Share (0 to 1) of the posting's distinct named skills that match the profile. */
function skillCoverage(posting: Posting, terms: readonly string[]): number | undefined {
  const skills = [...new Set(posting.skills.map(normaliseText).filter((skill) => skill !== ""))];
  if (skills.length === 0) return undefined;
  const matched = skills.filter((skill) => skillMatchesProfile(skill, terms));
  return matched.length / skills.length;
}

/** Share (0 to 1) of the full description signal reached by the profile terms in the text. */
function descriptionSignal(posting: Posting, terms: readonly string[]): number {
  const text = `${posting.title}\n${posting.description}`;
  const found = terms.filter(
    (term) => term.length > SHORT_TERM_LENGTH && containsWholeWord(text, term),
  );
  return Math.min(1, found.length / DESCRIPTION_TERMS_FOR_FULL_SIGNAL);
}

/** Scores how well `posting` matches `profile`, a whole number from 0 to 100. */
export function keywordScore(posting: Posting, profile: Profile): number {
  const terms = termsOfProfile(profile);
  const coverage = skillCoverage(posting, terms);
  const signal = descriptionSignal(posting, terms);
  const score =
    coverage === undefined ? 100 * signal : SKILL_WEIGHT * coverage + DESCRIPTION_WEIGHT * signal;
  return Math.round(Math.min(100, Math.max(0, score)));
}
