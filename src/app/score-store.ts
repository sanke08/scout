/**
 * Remembers what the model said about each posting, in `scores.json` in the data folder.
 *
 * Why it exists: the stored job record has no place for a shortlist score, reasons or unmet
 * requirements, yet the Digest card needs all three. It also makes "never pay twice for the same
 * posting" exact: the brain cache is keyed by a whole batch, so a posting that moves to another
 * batch would be paid for again, but a score kept here is looked up by posting id.
 *
 * A score is valid only for the profile version it was made with; after the profile changes, the
 * job is scored again.
 *
 * Example: `store.save("abc", { ...score })`, then `store.find("abc", 3)` returns it while the
 * profile is still at version 3 and `undefined` once the profile is at version 4.
 */
import { z } from "zod";
import { ScoutError } from "../shared/index.js";
import { readJsonFile, writeJsonFile } from "./json-file.js";

/** What is kept for one scored posting. */
export const storedScoreSchema = z.object({
  /** The profile version the score was made against. */
  profileVersion: z.number().int().nonnegative(),
  /** Combined shortlist score, 0 to 100. */
  shortlistScore: z.number().min(0).max(100),
  eligibility: z.number().min(0).max(100),
  desirability: z.number().min(0).max(100),
  /** Short plain-words reasons from the model. */
  reasons: z.array(z.string()),
  /** Must-have requirements the profile does not meet. */
  unmet: z.array(z.string()),
  /** Hard requirements the model could not confirm either way. */
  unknown: z.array(z.string()),
  redFlags: z.array(z.string()),
  /** Which engine answered, e.g. "claude". */
  engine: z.string(),
  /** ISO time the score was stored. */
  scoredAt: z.string(),
});
export type StoredScore = z.infer<typeof storedScoreSchema>;

/** The file format. */
const scoreFileSchema = z.object({
  schemaVersion: z.literal(1),
  scores: z.record(z.string(), storedScoreSchema),
});

/** Reads and writes model scores by posting id. */
export interface ScoreStore {
  /** The score for a posting, or `undefined` when none exists for this profile version. */
  find(postingId: string, profileVersion: number): StoredScore | undefined;
  /** Stores (or replaces) the score for a posting. */
  save(postingId: string, score: StoredScore): void;
}

/**
 * Creates the score store over the file at `path`.
 * Failure: a damaged file gives `invalid-input` naming the path; delete it to score again.
 */
export function createScoreStore(path: string): ScoreStore {
  /** Reads the whole file; a missing file is an empty record. */
  function readScores(): Record<string, StoredScore> {
    const raw = readJsonFile(path, "the score file");
    if (raw === undefined) return {};
    const parsed = scoreFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ScoutError(
        "invalid-input",
        `The score file at ${path} is not valid. Delete it and Scout will score the jobs again.`,
      );
    }
    return parsed.data.scores;
  }

  return {
    find(postingId, profileVersion) {
      const stored = readScores()[postingId];
      return stored !== undefined && stored.profileVersion === profileVersion ? stored : undefined;
    },
    save(postingId, score) {
      writeJsonFile(path, {
        schemaVersion: 1,
        scores: { ...readScores(), [postingId]: score },
      });
    },
  };
}
