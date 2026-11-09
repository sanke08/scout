/**
 * `scout apply-keep-open <jobId> --answers-file <file>`: the hidden helper that `apply_to_job`
 * starts at level "Fill, I submit". It is not meant to be typed by a person.
 *
 * Why it exists: at Fill the owner presses submit themselves, possibly minutes after the model's
 * run has ended and its tool process has exited (which would close the window and leave nothing to
 * record the outcome, so a later hunt could submit the same job again). This helper is a separate,
 * detached process: it opens Scout's persistent browser profile, fills the form with the profile
 * and the saved answers, keeps the window open, writes the submit marker BEFORE waiting, waits for a
 * confirmation message that was not on the page before, saves the evidence and records `applied`
 * (a new confirmation was seen) or `unverified` (not proven). It never presses submit itself.
 *
 * Safety: the pause switch is honoured before anything is filled; a lock file holding the helper's
 * process id keeps a second helper from taking the same job; the hand-off file must be inside the
 * data folder; the resume file and the page address are checked again like the tool checks them.
 * After a failure the job is left in `needs-you` with the reason, or `unverified` when the submit
 * marker was already written, never silently as it was.
 *
 * Example: `scout apply-keep-open 3f9a1c --answers-file <data>/apply-helpers/3f9a1c.json`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { runApplication } from "../../apply/index.js";
import type { CredentialVault } from "../../platforms/index.js";
import { ScoutError, type JobRecord } from "../../shared/index.js";
import { WAITING_FOR_SUBMIT_MARKER, returnFromNeedsYou } from "../../ledger/index.js";
import type { Application } from "../application.js";
import {
  buildRunContext,
  helperFolderOf,
  helperIsRunning,
  isPlannedForm,
  lockPathOf,
  openAndPlan,
  readyJobForRun,
  requireJob,
  runArguments,
  saveAnswers,
  type AutopilotServices,
  type RunContext,
} from "./apply-autopilot.js";
import type { ApplyEnvironment } from "./apply-environment.js";
import {
  closeQuietly,
  keepOpen,
  saveOwnerSubmitEvidence,
  waitForConfirmation,
} from "./apply-core.js";

/** How long the helper waits for the owner to press submit when `--wait` is not given (thirty minutes). */
export const KEEP_OPEN_WAIT_SECONDS = 1800;

/** The options of the hidden command. */
export interface KeepOpenOptions {
  /** The hand-off file the tool wrote, inside `<data>/apply-helpers/`. */
  answersFile: string;
  /** Seconds to wait for the confirmation after the owner presses submit. */
  wait?: string;
}

/** What the tool leaves in the hand-off file. */
const handOffSchema = z.object({
  answers: z.record(z.string(), z.string()).default({}),
  resumePath: z.string().optional(),
  applyUrl: z.string().optional(),
});

/** Statuses a job may be in when the helper starts besides the waiting `needs-you`. */
const STARTABLE_STATUSES: readonly JobRecord["status"][] = [
  "shortlisted",
  "resume-ready",
  "approved",
];

/** Reads `--wait`: a whole number of seconds, default thirty minutes. */
function parseWaitSeconds(text: string | undefined): number {
  if (text === undefined) return KEEP_OPEN_WAIT_SECONDS;
  const seconds = Number(text);
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new ScoutError(
      "invalid-input",
      `--wait needs a whole number of seconds (0 or more), but you gave "${text}".`,
    );
  }
  return seconds;
}

/** The hand-off file, proven to be inside the data folder's helper folder and readable. */
function readHandOff(application: Application, answersFile: string): z.infer<typeof handOffSchema> {
  const path = resolve(answersFile);
  if (!path.startsWith(resolve(helperFolderOf(application)) + sep) || !existsSync(path)) {
    throw new ScoutError(
      "invalid-input",
      "The answers file must be one of the hand-off files Scout wrote in its own apply-helpers folder.",
    );
  }
  try {
    return handOffSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new ScoutError("invalid-input", "The hand-off file could not be read.");
  }
}

/** Takes the job's lock (this process id) or refuses when a running helper holds it. */
function takeLock(application: Application, jobId: string): () => void {
  const path = lockPathOf(application, jobId);
  mkdirSync(helperFolderOf(application), { recursive: true });
  if (helperIsRunning(application, jobId)) {
    throw new ScoutError(
      "unsafe",
      `A helper window for job ${jobId} is already open, so a second one was not started.`,
    );
  }
  rmSync(path, { force: true });
  try {
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, startedAt: application.now().toISOString() }),
      {
        flag: "wx",
      },
    );
  } catch {
    throw new ScoutError("unsafe", `Another helper took the lock for job ${jobId} first.`);
  }
  return () => rmSync(path, { force: true });
}

/** True for a `needs-you` job whose reason says its filled form waits for the owner. */
function isWaiting(job: JobRecord): boolean {
  return (
    job.status === "needs-you" &&
    (job.statusReason ?? "").toLowerCase().includes(WAITING_FOR_SUBMIT_MARKER)
  );
}

/** Writes one line of what the helper did to the action log (it has no screen). */
function log(application: Application, jobId: string, detail: string): void {
  application.actionLog.append({ actor: "autopilot", action: "apply-helper", jobId, detail });
}

/** Leaves the job where the failure belongs: unverified after a submit marker, else needs-you. */
function recordFailure(application: Application, jobId: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const status = application.jobStore.get(jobId)?.status;
  try {
    if (status === "submitting") {
      application.jobStore.transition(
        jobId,
        "unverified",
        `The helper stopped after the form was handed to you (${detail}), so it is not known whether the application was sent. Scout will not retry; check the company's page and your email.`,
      );
    } else if (status === "shortlisted" || status === "resume-ready" || status === "approved") {
      application.jobStore.transition(
        jobId,
        "needs-you",
        `The helper could not fill the form (${detail}). Nothing was submitted. Put the job back with \`scout undo ${jobId}\`.`,
      );
    }
  } catch {
    // The job is in a state that needs no change; the action log has the reason.
  }
  log(application, jobId, `The helper stopped: ${detail}`);
}

/**
 * After the form is filled and checked: writes the submit marker (before waiting, so an unclear
 * result is never retried), waits for a new confirmation, records `applied` or `unverified` and
 * saves the evidence.
 */
async function waitForOwnerSubmit(
  context: RunContext,
  environment: ApplyEnvironment,
  planned: Parameters<typeof saveOwnerSubmitEvidence>[0]["plan"],
  driver: Parameters<typeof saveOwnerSubmitEvidence>[0]["driver"],
  startedAt: string,
  waitSeconds: number,
): Promise<void> {
  const { application, job } = context;
  const { jobStore } = application;
  if (jobStore.get(job.id)?.status === "resume-ready") {
    jobStore.transition(
      job.id,
      "approved",
      "The form was filled and left open for you to submit, so the job is recorded as approved to track the outcome.",
    );
  }
  jobStore.transition(
    job.id,
    "submitting",
    "Submit marker: the form was filled and left open for you to submit; written before waiting so an unclear result is never retried.",
  );
  const confirmation = await waitForConfirmation(driver, environment, waitSeconds);
  if (confirmation !== undefined) {
    jobStore.transition(
      job.id,
      "applied",
      "The page showed a confirmation message after you submitted, so the application is recorded as applied.",
    );
  } else {
    jobStore.transition(
      job.id,
      "unverified",
      `No confirmation message was seen within ${waitSeconds} seconds, so it is not known whether the application was sent. Scout will not retry; check the company's page and your email.`,
    );
  }
  try {
    await saveOwnerSubmitEvidence({
      driver,
      plan: planned,
      evidenceDirectory: context.evidenceDirectory,
      startedAt,
      finishedAt: application.now().toISOString(),
      profileVersion: context.profile.version,
      confirmationText: confirmation,
      outcome: confirmation === undefined ? "unverified" : "applied",
    });
  } catch (error) {
    log(
      application,
      job.id,
      `The final evidence could not be saved (${error instanceof Error ? error.message : String(error)}). The status is recorded.`,
    );
  }
  log(
    application,
    job.id,
    confirmation === undefined
      ? "No confirmation was seen: unverified."
      : "A confirmation was seen: applied.",
  );
}

/** The work of the helper once it holds the lock. */
async function fillAndWait(
  application: Application,
  services: AutopilotServices,
  jobId: string,
  options: KeepOpenOptions,
): Promise<void> {
  const handOff = readHandOff(application, options.answersFile);
  const waitSeconds = parseWaitSeconds(options.wait);
  const job = requireJob(application, jobId);
  if (isWaiting(job)) {
    returnFromNeedsYou(application.jobStore, jobId, "The helper window is starting.");
  } else if (!STARTABLE_STATUSES.includes(job.status)) {
    throw new ScoutError(
      "invalid-input",
      `Job ${jobId} is "${job.status}", so the helper has nothing to fill for it.`,
    );
  }
  try {
    application.assertNotPaused();
    const context = buildRunContext(
      application,
      services,
      requireJob(application, jobId),
      handOff,
      "fill",
    );
    const startedAt = application.now().toISOString();
    const driver = await services.environment.openBrowser({
      profileDirectory: resolve(application.directory, "browser-profile"),
      headless: false,
    });
    try {
      const planned = await openAndPlan(context, driver);
      if (!isPlannedForm(planned)) {
        log(application, jobId, `The helper stopped before filling: ${planned.message}`);
        return;
      }
      application.assertNotPaused();
      readyJobForRun(context);
      const run = await runApplication(
        runArguments(context, planned.plan, keepOpen(driver), "fill"),
      );
      saveAnswers(context, planned.plan, planned.mappings, planned.refused, planned.ignored);
      if (run.outcome !== "filled-for-review") {
        log(application, jobId, `The helper stopped: ${run.reason}`);
        return;
      }
      await waitForOwnerSubmit(
        context,
        services.environment,
        planned.plan,
        driver,
        startedAt,
        waitSeconds,
      );
    } finally {
      await closeQuietly(driver);
    }
  } catch (error) {
    recordFailure(application, jobId, error);
    throw error;
  }
}

/**
 * Runs the hidden helper. See the file comment.
 * Failure: a `ScoutError` when the hand-off is wrong, a second helper is refused, or Scout is
 * paused (the job is then put back where it came from and nothing is filled).
 */
export async function runKeepOpenCommand(
  application: Application,
  environment: ApplyEnvironment,
  vault: CredentialVault,
  jobId: string,
  options: KeepOpenOptions,
): Promise<void> {
  const release = takeLock(application, jobId);
  try {
    await fillAndWait(application, { environment, vault }, jobId, options);
  } finally {
    release();
    const handOffPath = resolve(options.answersFile);
    if (handOffPath.startsWith(resolve(helperFolderOf(application)) + sep)) {
      rmSync(handOffPath, { force: true });
    }
  }
}
