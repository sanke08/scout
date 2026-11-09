/**
 * Carries out a `FillPlan` safely: the one place in Scout that may press a submit button.
 *
 * Why: protections come before exposure. Every rule of IDEA 5.10 about levels, dry runs, the
 * submit marker and verification lives here in order, so a reviewer can read them top to bottom.
 *
 * The order of `runApplication`:
 *  1. Kill switch (`assertNotPaused`) before anything else.
 *  2. The job must be `resume-ready` or `approved`; a job already in `submitting` is refused
 *     because an interrupted submit is never retried blindly (Scenario O).
 *  3. A plan with blockers stops here and the job goes to `needs-you`. No browser opens.
 *  4. Level `prepare` stops here as `staged`. No browser opens.
 *  5. If a submit could happen, the daily limit is checked before the browser opens.
 *  6. Open the page; stop on a CAPTCHA, sign-in wall, one-time code, assessment or closed job;
 *     stop if the live form's shape differs from the plan's snapshot.
 *  7. Fill, read back and compare. Any mismatch stops with `needs-you`.
 *  8. Take the screenshot and save the evidence.
 *  9. Unless a submit is allowed, stop (`dry-run-complete` or `filled-for-review`).
 * 10. Move the job to `submitting` through the job store, THEN press submit once.
 * 11. Read the page afterwards. A confirmation message means `applied`; anything else, or any
 *     error, means `unverified`. There is no retry anywhere.
 *
 * A submit is allowed only when `mayAutoSubmit` says so: the run is live (not a dry run), the
 * board level is `auto`, the setting `applyMode` is `auto`, and the job is `approved`.
 */
import type { BoardLevel, JobRecord, JobStatus, JobStore, Settings } from "../shared/index.js";
import { ScoutError } from "../shared/index.js";
import { assertNotPaused } from "../store/index.js";
import type { BrowserDriver } from "./driver.js";
import { saveEvidence } from "./evidence.js";
import { fillAndVerify, type FillOutcome, type Mismatch } from "./fill-engine.js";
import { confirmationIsNew, detectPageBlocker, looksLikeConfirmation } from "./page-checks.js";
import type { Blocker, FillPlan } from "./plan.js";
import { snapshotForm } from "./snapshot.js";

/** `"live"` may submit when every rule allows; `"dry-run"` never submits (self-tests, new boards). */
export type RunMode = "live" | "dry-run";

/**
 * How a run ended.
 * - `staged`: level Prepare only; nothing was opened.
 * - `blocked`: the plan has blockers (unknown required fields); job moved to `needs-you`.
 * - `needs-you`: a page blocker, a changed form, a driver error or a read-back mismatch.
 * - `closed`: the page says the job no longer accepts applications.
 * - `dry-run-complete`: filled and verified, deliberately not submitted.
 * - `filled-for-review`: filled and verified; the user presses submit.
 * - `applied`: submitted and a confirmation message was seen.
 * - `unverified`: submit was attempted but no confirmation was seen, or the outcome is unknown.
 */
export type RunOutcome =
  | "staged"
  | "blocked"
  | "needs-you"
  | "closed"
  | "dry-run-complete"
  | "filled-for-review"
  | "applied"
  | "unverified";

/** Everything `runApplication` needs. All outside effects come in through these fields. */
export interface RunArguments {
  driver: BrowserDriver;
  plan: FillPlan;
  /** The board's level from the settings (`prepare`, `fill` or `auto`). */
  level: BoardLevel;
  /** `"dry-run"` forces a run that never submits. A live run is still a dry run for a new board (see `boardHasCleanRun`). */
  mode: RunMode;
  settings: Settings;
  jobs: JobStore;
  jobId: string;
  /** How many applications were submitted today. Compared with `settings.dailyApplicationLimit`. */
  appliedToday: () => number;
  /** True once this board has a clean-run record; when false and `dryRunFirst` is on, the run is a dry run. */
  boardHasCleanRun: boolean;
  /** The clock, injected so tests are deterministic. */
  now: () => Date;
  /** The profile `version` used, saved in the evidence. */
  profileVersion: number;
  /** Where to save evidence. Evidence is written before the submit marker; if saving fails nothing is submitted. */
  evidenceDirectory?: string;
  /**
   * Called once, right before the submit marker and the click, only when a submit is about to
   * happen. It may throw (for example `ScoutError("paused")` when the kill switch was turned on
   * while the form was being filled); the error leaves `runApplication` and nothing is submitted.
   */
  beforeSubmit?: () => void;
  /**
   * When true, a confirmation counts only if its wording was not already on the page before the
   * click (a banner on a re-opened form never counts). Unattended runs set it; default false.
   */
  requireNewConfirmation?: boolean;
}

/** The result of one run. */
export interface RunResult {
  outcome: RunOutcome;
  /** A full sentence saying what happened and what the user should do. */
  reason: string;
  /** The job's status after the run. */
  jobStatus: JobStatus;
  /** True only when `driver.submit` was called. */
  submitAttempted: boolean;
  /** The plan's blockers (set for `blocked`). */
  blockers: Blocker[];
  /** Field mismatches found on read-back (set for a read-back `needs-you`). */
  mismatches: Mismatch[];
  /** The confirmation text, when a submit was attempted and the page could be read. */
  confirmationText?: string;
  /** True when the run filled everything and every read-back matched (a "clean run" for the board). */
  cleanFill: boolean;
}

/**
 * The single rule that allows a submit: live run, board level `auto`, apply mode `auto`, and the
 * job approved. Example: `mayAutoSubmit({ level: "fill", ... })` is `false` whatever else is set.
 */
export function mayAutoSubmit(conditions: {
  dryRun: boolean;
  level: BoardLevel;
  applyMode: Settings["applyMode"];
  jobStatus: JobStatus;
}): boolean {
  return (
    !conditions.dryRun &&
    conditions.level === "auto" &&
    conditions.applyMode === "auto" &&
    conditions.jobStatus === "approved"
  );
}

/** Statuses a job may be in when a run starts. */
const RUNNABLE_STATUSES: readonly JobStatus[] = ["resume-ready", "approved"];

/** Builds a `RunResult` with defaults for the fields most outcomes leave empty. */
function result(
  jobs: JobStore,
  jobId: string,
  outcome: RunOutcome,
  reason: string,
  extra: Partial<RunResult> = {},
): RunResult {
  const job = jobs.get(jobId);
  return {
    outcome,
    reason,
    jobStatus: job === undefined ? "failed" : job.status,
    submitAttempted: false,
    blockers: [],
    mismatches: [],
    cleanFill: false,
    ...extra,
  };
}

/** Reads the job and refuses a job that is missing, already submitting, or in a state that cannot be applied for. */
function loadRunnableJob(jobs: JobStore, jobId: string): JobRecord {
  const job = jobs.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists, so there is nothing to apply for.`,
    );
  }
  if (job.status === "submitting") {
    throw new ScoutError(
      "unsafe",
      `Job ${jobId} is already being submitted, or a submit was interrupted. Scout never retries a submit blindly; check the company's page and your email, then mark the job yourself.`,
    );
  }
  if (!RUNNABLE_STATUSES.includes(job.status)) {
    throw new ScoutError(
      "invalid-input",
      `Job ${jobId} is "${job.status}", but applying needs it to be "resume-ready" or "approved".`,
    );
  }
  return job;
}

/** Closes the driver, ignoring a failure to close (the run's result matters more). */
async function closeQuietly(driver: BrowserDriver): Promise<void> {
  try {
    await driver.close();
  } catch {
    // The page may already be gone; the result of the run is already decided.
  }
}

/** Runs one application. See the file comment for the exact order of every check. */
export async function runApplication(args: RunArguments): Promise<RunResult> {
  const { plan, settings, jobs, jobId } = args;
  assertNotPaused(settings);
  const job = loadRunnableJob(jobs, jobId);

  if (plan.blockers.length > 0) {
    const names = plan.blockers.map((blocker) => blocker.label).join(", ");
    const reason = `Scout needs you before it can fill this form: ${names}.`;
    jobs.transition(jobId, "needs-you", reason);
    return result(jobs, jobId, "blocked", reason, { blockers: plan.blockers });
  }
  if (args.level === "prepare") {
    return result(
      jobs,
      jobId,
      "staged",
      "The board is set to Prepare only, so everything is ready and you submit by hand.",
    );
  }

  const dryRun = args.mode === "dry-run" || (settings.dryRunFirst && !args.boardHasCleanRun);
  const submitAllowed = mayAutoSubmit({
    dryRun,
    level: args.level,
    applyMode: settings.applyMode,
    jobStatus: job.status,
  });
  if (submitAllowed && args.appliedToday() >= settings.dailyApplicationLimit) {
    throw new ScoutError(
      "limit-reached",
      `Today's limit of ${settings.dailyApplicationLimit} applications is reached, so Scout will not submit another one until tomorrow.`,
    );
  }

  const startedAt = args.now().toISOString();
  try {
    return await fillAndMaybeSubmit(args, dryRun, submitAllowed, startedAt);
  } finally {
    await closeQuietly(args.driver);
  }
}

/** Opens the page, checks it, fills it, and submits when allowed. Steps 6 to 11 of the file comment. */
async function fillAndMaybeSubmit(
  args: RunArguments,
  dryRun: boolean,
  submitAllowed: boolean,
  startedAt: string,
): Promise<RunResult> {
  const { driver, plan, jobs, jobId } = args;
  const stopForYou = (reason: string, extra: Partial<RunResult> = {}): RunResult => {
    jobs.transition(jobId, "needs-you", reason);
    return result(jobs, jobId, "needs-you", reason, extra);
  };

  let fill: FillOutcome;
  let screenshot: Uint8Array;
  try {
    await driver.open(plan.url);
    const blocker = detectPageBlocker(await driver.pageText(), await driver.pageHtml());
    if (blocker !== undefined) {
      if (blocker.kind === "closed") {
        jobs.transition(jobId, "closed", blocker.reason);
        return result(jobs, jobId, "closed", blocker.reason);
      }
      return stopForYou(blocker.reason);
    }
    const live = snapshotForm(await driver.pageHtml());
    if (live.hash !== plan.snapshot.hash) {
      return stopForYou(
        "The form on the page is different from the one Scout saved, so it did not fill anything. Check the form and plan again.",
      );
    }
    fill = await fillAndVerify(driver, plan);
    if (fill.mismatches.length > 0) {
      const names = fill.mismatches.map((mismatch) => mismatch.label).join(", ");
      return stopForYou(
        `After filling, the page did not hold the values Scout typed for: ${names}. Nothing was submitted.`,
        { mismatches: fill.mismatches },
      );
    }
    const afterFill = detectPageBlocker(await driver.pageText(), await driver.pageHtml());
    if (afterFill !== undefined && afterFill.kind !== "closed") return stopForYou(afterFill.reason);
    screenshot = await driver.screenshot();
  } catch (error) {
    if (
      error instanceof ScoutError &&
      (error.code === "paused" || error.code === "illegal-transition")
    )
      throw error;
    const detail = error instanceof Error ? error.message : String(error);
    return stopForYou(
      `Scout could not finish filling the form (${detail}). Nothing was submitted.`,
    );
  }

  const evidence = {
    snapshot: plan.snapshot,
    filledValues: fill.filled,
    screenshotBeforeSubmit: screenshot,
    startedAt,
    profileVersion: args.profileVersion,
  };
  if (!submitAllowed) {
    const outcome: RunOutcome = dryRun ? "dry-run-complete" : "filled-for-review";
    if (args.evidenceDirectory !== undefined) {
      saveEvidence(args.evidenceDirectory, {
        ...evidence,
        finishedAt: args.now().toISOString(),
        outcome,
      });
    }
    const reason = dryRun
      ? "Dry run finished: the form was filled and checked, and nothing was submitted."
      : "The form is filled and checked. Review it and press submit yourself.";
    return result(jobs, jobId, outcome, reason, { cleanFill: true });
  }

  if (args.evidenceDirectory !== undefined) {
    saveEvidence(args.evidenceDirectory, { ...evidence, outcome: "submitting" });
  }
  return submitOnce(args, evidence);
}

/** Steps 10 and 11: the submit marker first, one click, then verify. Never retries. */
async function submitOnce(
  args: RunArguments,
  evidence: {
    snapshot: FillPlan["snapshot"];
    filledValues: Record<string, string>;
    screenshotBeforeSubmit: Uint8Array;
    startedAt: string;
    profileVersion: number;
  },
): Promise<RunResult> {
  const { driver, plan, jobs, jobId } = args;
  const submit = plan.snapshot.submit;
  if (submit === undefined) {
    throw new ScoutError("unsafe", "The plan has no submit button, so Scout refuses to submit.");
  }
  args.beforeSubmit?.();
  const textBeforeSubmit =
    args.requireNewConfirmation === true ? await readTextQuietly(driver) : "";
  jobs.transition(
    jobId,
    "submitting",
    "Submit marker set just before the final click; this is never retried.",
  );

  let confirmationText: string | undefined;
  let screenshotAfter: Uint8Array | undefined;
  let failure: string | undefined;
  try {
    await driver.submit(submit.selector);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (failure === undefined) {
    try {
      confirmationText = await driver.readConfirmation();
      screenshotAfter = await driver.screenshot();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  const finishedAt = args.now().toISOString();
  const confirmed =
    confirmationText !== undefined &&
    (args.requireNewConfirmation === true
      ? confirmationIsNew(textBeforeSubmit, confirmationText)
      : looksLikeConfirmation(confirmationText));
  const afterBlocker =
    confirmationText !== undefined && !confirmed
      ? detectPageBlocker(confirmationText, "")
      : undefined;
  const outcome: RunOutcome = confirmed
    ? "applied"
    : afterBlocker !== undefined
      ? "needs-you"
      : "unverified";

  const finalEvidence = { ...evidence, finishedAt, outcome };
  const extraEvidence = {
    ...(confirmationText !== undefined ? { confirmationText } : {}),
    ...(screenshotAfter !== undefined ? { screenshotAfterSubmit: screenshotAfter } : {}),
  };
  const extra: Partial<RunResult> = {
    submitAttempted: true,
    cleanFill: true,
    ...(confirmationText !== undefined ? { confirmationText } : {}),
  };

  if (confirmed) {
    const reason =
      "The page showed a confirmation message, so the application is recorded as applied.";
    jobs.transition(jobId, "applied", reason);
    saveEvidenceIfAsked(args, { ...finalEvidence, ...extraEvidence });
    return result(jobs, jobId, "applied", reason, extra);
  }
  if (afterBlocker !== undefined) {
    jobs.transition(jobId, "needs-you", afterBlocker.reason);
    saveEvidenceIfAsked(args, { ...finalEvidence, ...extraEvidence });
    return result(jobs, jobId, "needs-you", afterBlocker.reason, extra);
  }
  const why =
    failure !== undefined
      ? `The submit step ended with an error (${failure}), so it is not known whether the application was sent.`
      : "No confirmation message was seen after the submit, so it is not known whether the application was sent.";
  const reason = `${why} Scout will not retry; check the company's page and your email.`;
  jobs.transition(jobId, "unverified", reason);
  saveEvidenceIfAsked(args, { ...finalEvidence, ...extraEvidence });
  return result(jobs, jobId, "unverified", reason, extra);
}

/** The page text before the click, or an empty text when the page cannot be read (then any confirmation is new). */
async function readTextQuietly(driver: BrowserDriver): Promise<string> {
  try {
    return await driver.readConfirmation();
  } catch {
    return "";
  }
}

/** Saves the final evidence when a folder was given. A failure here does not undo the submit result. */
function saveEvidenceIfAsked(
  args: RunArguments,
  evidence: Parameters<typeof saveEvidence>[1],
): void {
  if (args.evidenceDirectory === undefined) return;
  try {
    saveEvidence(args.evidenceDirectory, evidence);
  } catch {
    // The status is already recorded in the job store; the pre-submit evidence is still on disk.
  }
}
