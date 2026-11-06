/**
 * The shapes of the batched model scoring step (Scout idea document, 5.6, steps 3 and 4):
 * the reply schema, the combination of two scores into one, and the confidence bands.
 *
 * The model only ever returns data of this shape; nothing here lets a reply trigger an action.
 */
import { z } from "zod";
import type { Settings } from "../shared/index.js";

/** Below this eligibility the job is out of reach, whatever its appeal: the shortlist score is 0. */
export const ELIGIBILITY_GATE = 40;

/** Share of the shortlist score that comes from eligibility (the rest is desirability). */
export const ELIGIBILITY_WEIGHT = 0.4;

/** Share of the shortlist score that comes from desirability. */
export const DESIRABILITY_WEIGHT = 0.6;

/** Points taken off for each unmet requirement, so such jobs "move down" (scenario E). */
export const UNMET_REQUIREMENT_PENALTY = 5;

/** The most that unmet requirements can take off. */
export const MAXIMUM_UNMET_PENALTY = 15;

/** How many points below the shortlist threshold the "review" band reaches. */
export const REVIEW_BAND_WIDTH = 15;

/** A score from 0 to 100. */
const percentSchema = z.number().min(0).max(100);

/**
 * The model's judgement of one posting.
 * - `eligibility`: could the user plausibly and legally get this job (0 to 100).
 * - `desirability`: does the user want it (0 to 100).
 * - `reasons`: three to five short sentences explaining the scores.
 * - `unmetRequirements`: must-haves the profile does not meet.
 * - `unknownRequirements`: hard requirements the profile cannot confirm either way.
 * - `redFlags`: worrying things in the posting.
 */
export const postingScoreSchema = z.object({
  postingId: z.string().min(1),
  eligibility: percentSchema,
  desirability: percentSchema,
  reasons: z.array(z.string().min(1).max(300)).min(3).max(5),
  unmetRequirements: z.array(z.string()),
  unknownRequirements: z.array(z.string()),
  redFlags: z.array(z.string()),
});
export type PostingScore = z.infer<typeof postingScoreSchema>;

/**
 * The reply to one batched scoring request: one entry per posting, each posting id at most once.
 * A reply that repeats an id fails validation, and the caller treats that as an invalid output.
 *
 * Example: `{ scores: [{ postingId: "a1", eligibility: 80, desirability: 70, reasons: [...] ... }] }`.
 */
export const scoreBatchResultSchema = z.object({
  scores: z
    .array(postingScoreSchema)
    .refine((scores) => new Set(scores.map((score) => score.postingId)).size === scores.length, {
      message: "Each posting id may appear only once.",
    }),
});
export type ScoreBatchResult = z.infer<typeof scoreBatchResultSchema>;

/**
 * Combines the two model scores into the one shortlist score shown on the card (0 to 100).
 *
 * Formula: if eligibility is below `ELIGIBILITY_GATE` (40) the result is 0, because a job the
 * user cannot get is never worth their attention. Otherwise
 * `0.4 * eligibility + 0.6 * desirability`, minus 5 points per unmet requirement (at most 15),
 * rounded, never below 0.
 *
 * Example: eligibility 80, desirability 70, no unmet requirements gives 74;
 * eligibility 39, desirability 100 gives 0; the first example with two unmet requirements gives 64.
 */
export function combineScores(
  score: Pick<PostingScore, "eligibility" | "desirability" | "unmetRequirements">,
): number {
  if (score.eligibility < ELIGIBILITY_GATE) return 0;
  const mix = ELIGIBILITY_WEIGHT * score.eligibility + DESIRABILITY_WEIGHT * score.desirability;
  const penalty = Math.min(
    MAXIMUM_UNMET_PENALTY,
    UNMET_REQUIREMENT_PENALTY * score.unmetRequirements.length,
  );
  return Math.max(0, Math.round(mix - penalty));
}

/** Where a scored job goes: the shortlist, the review list, or skipped with its reason recorded. */
export type ConfidenceBand = "shortlist" | "review" | "skip";

/**
 * Sorts a shortlist score into a band using `settings.minimumShortlistScore` (the threshold).
 * - score at or above the threshold: `shortlist`;
 * - up to 15 points below it (threshold minus 15 up to just under the threshold): `review`;
 * - lower: `skip`.
 * An unknown on a hard requirement is a question for the user, not a guess, so it is always
 * `review`, whatever the score.
 *
 * Example with threshold 75: 75 is `shortlist`, 74 and 60 are `review`, 59 is `skip`;
 * 90 with `hasUnknownHardRequirement` true is `review`.
 */
export function confidenceBand(
  score: number,
  settings: Pick<Settings, "minimumShortlistScore">,
  hasUnknownHardRequirement = false,
): ConfidenceBand {
  if (hasUnknownHardRequirement) return "review";
  const threshold = settings.minimumShortlistScore;
  if (score >= threshold) return "shortlist";
  if (score >= threshold - REVIEW_BAND_WIDTH) return "review";
  return "skip";
}
