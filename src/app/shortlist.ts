/**
 * The shortlisting step of a discovery pass (idea document 5.6, steps 3 and 4, and scenario K).
 *
 * It takes jobs that survived the hard rules and are still `found`, scores the best of them with
 * the model in batches, and moves each to the right place:
 * - at or above the threshold: `shortlisted`;
 * - in the review band: stays `found` (the Digest's review list);
 * - below it: `skipped` with the model's reason recorded.
 *
 * When the model reports its limit or cannot be run, the step DEGRADES instead of failing: the
 * rest of the candidates are shortlisted on keyword score alone, only if the score is high, and
 * the summary says so. It never calls the model for a job that already has a score for the current
 * profile version.
 *
 * Example: 3 candidates and a model that returns 80, 62 and 20 give 1 shortlisted, 1 kept for
 * review and 1 skipped. The same 3 with a limit-reached model and keyword scores 70, 65 and 10
 * give 2 shortlisted on keywords and 1 left found.
 */
import {
  chunkForScoring,
  buildScoreRequest,
  combineScores,
  confidenceBand,
  rankPostings,
} from "../decide/index.js";
import type { PostingScore } from "../decide/index.js";
import type { Brain, JobRecord, Profile, Settings } from "../shared/index.js";
import type { Application } from "./application.js";

/** The most jobs sent to the model in one pass (two full batches), so one pass has a bounded cost. */
export const SCORING_CANDIDATES_PER_PASS = 40;

/** In degraded mode a job needs at least this keyword score (0 to 100) to be shortlisted. Deliberately high. */
export const DEGRADED_KEYWORD_THRESHOLD = 60;

/** In degraded mode at most this many jobs are shortlisted on keywords alone. */
export const DEGRADED_SHORTLIST_LIMIT = 10;

/** What the shortlisting step did, added into the pass summary. */
export interface ShortlistOutcome {
  /** "degraded" when the model reported its limit or could not be run, otherwise "model". */
  mode: "model" | "degraded";
  scoredByModel: number;
  shortlisted: number;
  keptForReview: number;
  skippedByScore: number;
  /** Jobs still `found` with no score, waiting for the model. */
  waitingForScoring: number;
  /** Plain-words notes for the user, e.g. "The model's usage limit was reached." */
  reasons: string[];
}

/** Rounds a score for use in a sentence. */
function whole(value: number): string {
  return String(Math.round(value));
}

/**
 * Applies one model score to one job: stores it, then shortlists, keeps or skips the job.
 * Returns which of the three happened.
 */
function applyModelScore(
  application: Application,
  job: JobRecord,
  score: PostingScore,
  engine: string,
  profile: Profile,
  settings: Settings,
): "shortlist" | "review" | "skip" {
  const shortlistScore = combineScores(score);
  application.scoreStore.save(job.id, {
    profileVersion: profile.version,
    shortlistScore,
    eligibility: score.eligibility,
    desirability: score.desirability,
    reasons: score.reasons,
    unmet: score.unmetRequirements,
    unknown: score.unknownRequirements,
    redFlags: score.redFlags,
    engine,
    scoredAt: application.now().toISOString(),
  });
  const band = confidenceBand(shortlistScore, settings, score.unknownRequirements.length > 0);
  if (band === "shortlist") {
    application.jobStore.transition(
      job.id,
      "shortlisted",
      `Shortlist score ${whole(shortlistScore)} (eligibility ${whole(score.eligibility)}, desirability ${whole(score.desirability)}), at or above ${settings.minimumShortlistScore}.`,
    );
  } else if (band === "skip") {
    application.jobStore.transition(
      job.id,
      "skipped",
      `Low fit: shortlist score ${whole(shortlistScore)} is more than 15 below ${settings.minimumShortlistScore}. ${score.reasons[0] ?? ""}`.trim(),
    );
  }
  return band;
}

/**
 * Shortlists jobs on keyword score alone, used when the model cannot answer.
 * Only the best `DEGRADED_SHORTLIST_LIMIT` above `DEGRADED_KEYWORD_THRESHOLD` are moved.
 * Returns how many jobs were shortlisted.
 */
function shortlistOnKeywords(
  application: Application,
  ranked: { posting: JobRecord; score: number }[],
  why: string,
): number {
  let shortlisted = 0;
  for (const { posting, score } of ranked) {
    if (shortlisted >= DEGRADED_SHORTLIST_LIMIT || score < DEGRADED_KEYWORD_THRESHOLD) break;
    application.jobStore.transition(
      posting.id,
      "shortlisted",
      `Shortlisted on keyword match only (score ${whole(score)} of 100) because ${why}`,
    );
    shortlisted += 1;
  }
  return shortlisted;
}

/**
 * Scores the best unscored `found` jobs and moves them. `brain` is fetched lazily so a pass with
 * nothing to score never needs the model or even a profile version.
 *
 * Failure: never throws for a model problem; a limit or an unavailable engine becomes degraded
 * mode, and invalid output leaves that batch `found` with a note.
 */
export async function shortlistJobs(
  application: Application,
  profile: Profile,
  settings: Settings,
): Promise<ShortlistOutcome> {
  const outcome: ShortlistOutcome = {
    mode: "model",
    scoredByModel: 0,
    shortlisted: 0,
    keptForReview: 0,
    skippedByScore: 0,
    waitingForScoring: 0,
    reasons: [],
  };
  const unscored = application.jobStore
    .list({ status: "found" })
    .filter((job) => application.scoreStore.find(job.id, profile.version) === undefined);
  if (unscored.length === 0) return outcome;

  const jobsById = new Map<string, JobRecord>(unscored.map((job) => [job.id, job]));
  const ranked = rankPostings(unscored, profile).map(({ posting, score }) => ({
    posting: jobsById.get(posting.id)!,
    score,
  }));
  const candidates = ranked.slice(0, SCORING_CANDIDATES_PER_PASS);
  outcome.waitingForScoring = ranked.length;

  const brain: Brain = application.brain();
  const batches = chunkForScoring(candidates.map((entry) => entry.posting));
  let handled = 0;
  for (const batch of batches) {
    const result = await brain.run(buildScoreRequest(batch, profile));
    if (!result.ok && result.reason !== "invalid-output") {
      outcome.mode = "degraded";
      const reset = result.resetAt === undefined ? "" : ` It resets at ${result.resetAt}.`;
      const cause =
        result.reason === "limit-reached"
          ? `the model's usage limit was reached.${reset}`
          : `the model could not be used (${result.message})`;
      outcome.reasons.push(
        `Degraded mode: ${cause} Jobs were shortlisted on keyword score alone, and the rest wait for the model.`,
      );
      const remaining = candidates.slice(handled);
      const moved = shortlistOnKeywords(application, remaining, cause);
      outcome.shortlisted += moved;
      outcome.waitingForScoring -= moved;
      return outcome;
    }
    if (!result.ok) {
      outcome.reasons.push(
        `The model's reply for ${batch.length} job(s) was not in the expected shape, so they stay found. ${result.message}`,
      );
      handled += batch.length;
      continue;
    }
    const scoresById = new Map(result.value.scores.map((score) => [score.postingId, score]));
    for (const posting of batch) {
      const score = scoresById.get(posting.id);
      if (score === undefined) {
        outcome.reasons.push(
          `The model gave no score for "${posting.title}" at ${posting.company}, so it stays found.`,
        );
        continue;
      }
      const band = applyModelScore(
        application,
        jobsById.get(posting.id)!,
        score,
        result.engine,
        profile,
        settings,
      );
      outcome.scoredByModel += 1;
      outcome.waitingForScoring -= 1;
      if (band === "shortlist") outcome.shortlisted += 1;
      else if (band === "review") outcome.keptForReview += 1;
      else outcome.skippedByScore += 1;
    }
    handled += batch.length;
  }
  return outcome;
}
