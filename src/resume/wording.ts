/**
 * Choosing the wording of a point (or of the summary) for one job.
 *
 * Only wordings the user approved are ever used: the base text, or an alternate wording stored
 * next to it. This module never writes new text.
 */
import type { Variant } from "../shared/index.js";
import { containsTerm, containsWholeWord } from "./keywords.js";

/** The text chosen for one point and what it supports for the job. */
export interface ChosenWording {
  /** The base text or the winning alternate wording. */
  text: string;
  /** True when an alternate wording won over the base text. */
  usedVariant: boolean;
  /**
   * Job keywords this wording supports: the keyword is one of the point's `allowed` terms, or it
   * appears as a whole word in the chosen text.
   */
  matchedKeywords: string[];
}

/** The pieces of a point that wording depends on (a summary has no allowed terms). */
export interface WordingSource {
  text: string;
  allowed: readonly string[];
  variants: readonly Variant[];
}

/**
 * Picks the wording for one job: the alternate wording whose `keys` match the most job keywords,
 * or the base text when none matches. On a tie between alternates the earlier one wins; the base
 * text wins a tie with zero matches.
 *
 * Example: for a point whose alternate has keys ["redis", "caching"] and job keywords
 * ["redis"], the alternate text is returned with `usedVariant` true.
 * `keywords` must already be normalised (see `normalizeKeywords`).
 */
export function chooseWording(source: WordingSource, keywords: readonly string[]): ChosenWording {
  let bestVariant: Variant | undefined;
  let bestCount = 0;
  for (const variant of source.variants) {
    const count = variant.keys.filter((key) => keywords.includes(key.toLowerCase())).length;
    if (count > bestCount) {
      bestCount = count;
      bestVariant = variant;
    }
  }
  const text = bestVariant === undefined ? source.text : bestVariant.text;
  const matchedKeywords = keywords.filter(
    (keyword) => containsTerm(source.allowed, keyword) || containsWholeWord(text, keyword),
  );
  return { text, usedVariant: bestVariant !== undefined, matchedKeywords };
}
