/**
 * Ranking of postings by keyword score.
 *
 * Why: the best candidates go to the model first, so the order must be the same on every run.
 *
 * Example: `rankPostings([a, b], profile)` returns `[{ posting: b, score: 80 }, { posting: a, score: 20 }]`.
 * Postings with equal scores keep their input order.
 */
import type { Posting, Profile } from "../shared/index.js";
import { keywordScore } from "./keyword-score.js";

/** A posting with its keyword score. */
export interface RankedPosting {
  posting: Posting;
  score: number;
}

/** Scores every posting and sorts best first; ties keep the order they came in. */
export function rankPostings(postings: readonly Posting[], profile: Profile): RankedPosting[] {
  const scored = postings.map((posting, position) => ({
    posting,
    score: keywordScore(posting, profile),
    position,
  }));
  scored.sort((first, second) => second.score - first.score || first.position - second.position);
  return scored.map(({ posting, score }) => ({ posting, score }));
}
