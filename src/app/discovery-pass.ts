/**
 * One discovery pass: read every watched board, drop what the hard rules refuse (recording why),
 * save the rest, and shortlist the best (scenarios D and E, and degraded mode of scenario K).
 *
 * Why it exists: the CLI's `discover` command and, later, the scheduled run both need the whole
 * funnel in one call. Discovery does not act on the user's behalf (no forms, no submits), so the
 * kill switch does not stop it.
 *
 * Example: `const summary = await runDiscoveryPass(application)` gives
 * `{ mode: "model", postingsFetched: 12, droppedByRules: 8, shortlisted: 2, ... }`.
 */
import { dedupePostings } from "../discovery/index.js";
import { missingRequiredFields } from "../profile/index.js";
import { ScoutError, type Posting } from "../shared/index.js";
import type { Application } from "./application.js";
import { shortlistJobs } from "./shortlist.js";

/** One board that could not be read, and why. */
export interface FailedBoard {
  /** Board name, e.g. "greenhouse:examplecorp". */
  board: string;
  /** The full-sentence reason from discovery. */
  message: string;
}

/** What one pass did. Every number counts jobs. */
export interface DiscoveryPassSummary {
  /** "degraded" when the model could not be used and keyword scores decided the shortlist. */
  mode: "model" | "degraded";
  boardsRead: number;
  boardsFailed: FailedBoard[];
  /** Postings read from all boards before merging duplicates. */
  postingsFetched: number;
  postingsAfterDedupe: number;
  /** Jobs newly recorded as `skipped` by a hard rule in this pass (each with its reasons stored). */
  droppedByRules: number;
  /** Jobs that passed the hard rules and are saved as found. */
  keptAfterRules: number;
  scoredByModel: number;
  shortlisted: number;
  /** Scored in the review band: still `found`, shown in the Digest's review list. */
  keptForReview: number;
  /** Scored far below the threshold and recorded as `skipped` with the model's reason. */
  skippedByScore: number;
  /** Found jobs that still have no score and wait for the model. */
  waitingForScoring: number;
  /** Plain-words notes, including why a mode is degraded and why a board failed. */
  reasons: string[];
}

/** Throws unless the profile exists and has every field the rules need. */
function loadReadyProfile(
  application: Application,
): ReturnType<Application["profileStore"]["load"]> {
  if (!application.profileStore.exists()) {
    throw new ScoutError(
      "not-found",
      'There is no profile yet. Run "scout init" to create one, then edit profile.json in your data folder.',
    );
  }
  const profile = application.profileStore.load();
  const missing = missingRequiredFields(profile);
  if (missing.length > 0) {
    throw new ScoutError(
      "invalid-input",
      `Your profile is not complete, so discovery cannot judge jobs yet. Fill in: ${missing.map((field) => field.path).join(", ")}.`,
    );
  }
  return profile;
}

/** Reads every board; a board that fails is reported and does not stop the others. */
async function fetchAllBoards(
  application: Application,
  now: Date,
): Promise<{ postings: Posting[]; boardsRead: number; failures: FailedBoard[] }> {
  const postings: Posting[] = [];
  const failures: FailedBoard[] = [];
  let boardsRead = 0;
  for (const board of application.boardStore.list()) {
    const name = `${board.kind}:${board.token}`;
    try {
      postings.push(...(await application.discovery.fetchBoard(board, now)));
      boardsRead += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ board: name, message });
    }
  }
  return { postings, boardsRead, failures };
}

/**
 * Runs the whole funnel once and returns what happened.
 *
 * Failure: no profile, or an incomplete one, throws a `ScoutError` saying what to fix. A board
 * that cannot be read, or a model that cannot answer, does not throw; it is in the summary.
 */
export async function runDiscoveryPass(application: Application): Promise<DiscoveryPassSummary> {
  const profile = loadReadyProfile(application);
  const settings = application.settingsStore.load();
  const now = application.now();

  const fetched = await fetchAllBoards(application, now);
  const postings = dedupePostings(fetched.postings);
  const decider = application.decider();

  let droppedByRules = 0;
  let keptAfterRules = 0;
  for (const posting of postings) {
    const existing = application.jobStore.get(posting.id);
    if (existing !== undefined && existing.status !== "found") {
      application.jobStore.upsertPosting(posting);
      continue;
    }
    const verdict = decider.applyHardRules(posting, profile, settings);
    application.jobStore.upsertPosting(posting);
    if (verdict.keep) {
      keptAfterRules += 1;
      continue;
    }
    application.jobStore.transition(posting.id, "skipped", verdict.reasons.join(" "));
    droppedByRules += 1;
  }

  const outcome = await shortlistJobs(application, profile, settings);
  const summary: DiscoveryPassSummary = {
    mode: outcome.mode,
    boardsRead: fetched.boardsRead,
    boardsFailed: fetched.failures,
    postingsFetched: fetched.postings.length,
    postingsAfterDedupe: postings.length,
    droppedByRules,
    keptAfterRules,
    scoredByModel: outcome.scoredByModel,
    shortlisted: outcome.shortlisted,
    keptForReview: outcome.keptForReview,
    skippedByScore: outcome.skippedByScore,
    waitingForScoring: outcome.waitingForScoring,
    reasons: [
      ...fetched.failures.map(
        (failure) => `Board ${failure.board} was not read: ${failure.message}`,
      ),
      ...outcome.reasons,
    ],
  };
  application.actionLog.append({
    actor: "app",
    action: "discovery-pass",
    detail: `Mode ${summary.mode}: ${summary.postingsFetched} fetched, ${summary.droppedByRules} dropped by rules, ${summary.shortlisted} shortlisted.`,
  });
  return summary;
}
