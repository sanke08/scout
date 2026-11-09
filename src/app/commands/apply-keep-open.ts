/**
 * `scout apply-keep-open <jobId> --answers-file <file>`: the hidden helper that `apply_to_job`
 * starts at level "Fill, I submit". It is not meant to be typed by a person.
 *
 * Why it exists: at Fill the owner presses submit themselves, possibly minutes after the model's
 * run has ended and its tool process has exited (which would close the window and leave nothing to
 * record the outcome, so a later hunt could submit the same job again). This helper is a separate,
 * detached process: it opens Scout's persistent browser profile, fills the form with the profile
 * and the saved answers and keeps the window open. While it waits the job is `needs-you` ("waiting
 * for you to press submit") and the private hand-off record says so (that record, not any wording,
 * is what lets the ledger accept the owner's own submit). The submit marker is written only when the
 * page CHANGES after the baseline taken when the form was ready (the owner clicked something or the
 * page moved on). A new confirmation message then records `applied`; a changed page without one
 * records `unverified`. If nothing at all changed within the wait, nothing was sent: the job goes
 * back to where it was, with a reason saying so, and it does not count toward the daily limit.
 * The helper never presses submit itself.
 *
 * Safety: the pause switch is honoured before anything is filled and on every look while waiting
 * (then it exits with nothing sent); a lock file holding the helper's process id keeps a second
 * helper from taking the same job or the browser profile; the hand-off file must be inside the
 * data folder and carry the token `apply_to_job` made; the resume file and the page address are
 * checked again like the tool checks them. After a failure the job is left in `needs-you` with the
 * reason, or `unverified` when the submit marker was already written, never silently as it was.
 * A helper that is killed outright (SIGKILL) leaves a stale lock file; the next start treats it as
 * stale because its process no longer exists.
 *
 * Example: `scout apply-keep-open 3f9a1c --answers-file <data>/apply-helpers/3f9a1c.json`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { confirmationIsNew, runApplication } from "../../apply/index.js";
import type { CredentialVault } from "../../platforms/index.js";
import { ScoutError, type JobRecord } from "../../shared/index.js";
import { WAITING_FOR_SUBMIT_REASON, returnFromNeedsYou } from "../../ledger/index.js";
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
import { closeQuietly, keepOpen, saveOwnerSubmitEvidence } from "./apply-core.js";

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
  token: z.string().optional(),
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
      JSON.stringify({
        pid: process.pid,
        jobId,
        startedAt: application.now().toISOString(),
      }),
      {
        flag: "wx",
      },
    );
  } catch {
    throw new ScoutError("unsafe", `Another helper took the lock for job ${jobId} first.`);
  }
  return () => rmSync(path, { force: true });
}

/** True for a `needs-you` job that is the one waiting in a hand-off made by `apply_to_job`. */
function isWaiting(application: Application, job: JobRecord): boolean {
  return job.status === "needs-you" && application.handoffs.isWaiting(job.id);
}

/** Writes one line of what the helper did to the action log (it has no screen). */
function log(application: Application, jobId: string, detail: string): void {
  application.actionLog.append({ actor: "autopilot", action: "apply-helper", jobId, detail });
}

/**
 * Leaves the job where the failure belongs: unverified after a submit marker; back where it was
 * (with the reason) when it was only waiting for the owner; else needs-you.
 */
function recordFailure(application: Application, jobId: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const job = application.jobStore.get(jobId);
  const status = job?.status;
  const wasWaiting = job !== undefined && isWaiting(application, job);
  try {
    if (status === "submitting") {
      application.jobStore.transition(
        jobId,
        "unverified",
        `The helper stopped after the form was handed to you (${detail}), so it is not known whether the application was sent. Scout will not retry; check the company's page and your email.`,
      );
    } else if (wasWaiting) {
      returnFromNeedsYou(
        application.jobStore,
        jobId,
        `The helper stopped while waiting for you (${detail}) before any change to the page was seen, so nothing is known to have been sent. Run \`scout apply ${jobId}\` when ready.`,
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

/** How long the helper sleeps between two looks at the page, in milliseconds. */
const LOOK_MILLISECONDS = 3000;

/** The page text with white space tidied, so a harmless re-flow is not seen as a change. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The page's text, or an empty text when the page cannot be read (it may be between two loads). */
async function readTextQuietly(driver: Parameters<typeof closeQuietly>[0]): Promise<string> {
  try {
    return await driver.readConfirmation();
  } catch {
    return "";
  }
}

/** The page's address, or an empty text when it cannot be read. */
async function readAddressQuietly(driver: Parameters<typeof closeQuietly>[0]): Promise<string> {
  try {
    return await driver.currentUrl();
  } catch {
    return "";
  }
}

/** Writes the submit marker once the page has changed: back from `needs-you`, through `approved`. */
function writeSubmitMarker(application: Application, jobId: string): void {
  const { jobStore } = application;
  returnFromNeedsYou(
    jobStore,
    jobId,
    "The page changed after the form was handed to you, so you may have pressed submit.",
  );
  if (jobStore.get(jobId)?.status !== "approved") {
    jobStore.transition(
      jobId,
      "approved",
      "The page changed after the form was handed to you, so the job is recorded as approved to track the outcome.",
    );
  }
  jobStore.transition(
    jobId,
    "submitting",
    "Submit marker: the page changed after the form was handed to you (you may have pressed submit); written before looking for a confirmation so an unclear result is never retried.",
  );
}

/**
 * After the form is filled and checked: records that the helper is waiting (no submit marker yet),
 * then looks at the page every few seconds. The first change from the baseline (different text or
 * address) writes the submit marker; a confirmation that was not on the page before records
 * `applied`; a changed page that never shows one records `unverified`. When nothing changed at all
 * within the wait, or Scout was paused, nothing was sent: the job returns to where it was.
 */
async function waitForOwnerSubmit(
  context: RunContext,
  environment: ApplyEnvironment,
  planned: Parameters<typeof saveOwnerSubmitEvidence>[0]["plan"],
  driver: Parameters<typeof saveOwnerSubmitEvidence>[0]["driver"],
  startedAt: string,
  waitSeconds: number,
  token: string | undefined,
): Promise<void> {
  const { application, job } = context;
  const { jobStore } = application;
  const baselineText = await readTextQuietly(driver);
  const baselineAddress = await readAddressQuietly(driver);
  jobStore.transition(job.id, "needs-you", WAITING_FOR_SUBMIT_REASON);
  application.handoffs.markWaiting(job.id, token);

  let markerWritten = false;
  let confirmation: string | undefined;
  let waitedMilliseconds = 0;
  let pausedReason: string | undefined;
  for (;;) {
    if (!markerWritten) {
      try {
        application.assertNotPaused();
      } catch {
        pausedReason = "Scout was paused";
        break;
      }
    }
    if (!markerWritten && jobStore.get(job.id)?.status !== "needs-you") {
      // The owner recorded the result themselves (the ledger moved the job): nothing left to do.
      log(
        application,
        job.id,
        "The job was moved by someone else while waiting; the helper left it.",
      );
      return;
    }
    const text = await readTextQuietly(driver);
    const address = await readAddressQuietly(driver);
    const changed = tidy(text) !== tidy(baselineText) || address !== baselineAddress;
    if (changed && !markerWritten) {
      writeSubmitMarker(application, job.id);
      markerWritten = true;
      waitedMilliseconds = 0;
    }
    if (markerWritten && confirmationIsNew(baselineText, text)) {
      confirmation = text;
      break;
    }
    if (waitedMilliseconds >= waitSeconds * 1000) break;
    await environment.pause(LOOK_MILLISECONDS);
    waitedMilliseconds += LOOK_MILLISECONDS;
  }

  if (!markerWritten) {
    const minutes = Math.max(1, Math.ceil(waitSeconds / 60));
    returnFromNeedsYou(
      jobStore,
      job.id,
      pausedReason === undefined
        ? `You did not submit within ${minutes} minutes; nothing was sent. Run \`scout apply ${job.id}\` when ready.`
        : `${pausedReason}, so the window was closed before you submitted; nothing was sent. Run \`scout apply ${job.id}\` when ready.`,
    );
    log(
      application,
      job.id,
      pausedReason === undefined
        ? "The page never changed within the wait: nothing was sent, the job was put back."
        : "Scout was paused while waiting: nothing was sent, the job was put back.",
    );
    return;
  }
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
      `The page changed but no confirmation message was seen within ${waitSeconds} seconds, so it is not known whether the application was sent. Scout will not retry; check the company's page and your email.`,
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
      ? "The page changed but no confirmation was seen: unverified."
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
  if (!application.handoffs.matches(jobId, handOff.token)) {
    throw new ScoutError(
      "unsafe",
      `This hand-off file was not written by Scout's apply tool for job ${jobId} (its token does not match Scout's private record), so the helper did nothing.`,
    );
  }
  if (job.status === "needs-you") {
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
        handOff.token,
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
    application.handoffs.end(jobId);
    const handOffPath = resolve(options.answersFile);
    if (handOffPath.startsWith(resolve(helperFolderOf(application)) + sep)) {
      rmSync(handOffPath, { force: true });
    }
  }
}
