/**
 * Applying without a person at the keyboard: the path the autopilot tools (`get_form`,
 * `apply_to_job`) use. It never prints and never asks a question; every outcome is a value the
 * model reads, and every refusal is a `ScoutError` with a sentence the model can act on.
 *
 * Why it exists (D-013): the model decides which jobs to apply to and what the unusual questions
 * deserve. Scout still owns the safety of the act itself, so this file reuses the same apply module
 * as `scout apply`: `runApplication` is the only code that presses submit, the submit marker is
 * written before the click, the daily limit is claimed in the same database transaction as that
 * marker, the kill switch is checked (again right before the click), a confirmation counts only when its wording is new after the click, and a job
 * is never submitted twice because the state machine refuses it.
 *
 * What the owner's level per board means here (no typed yes exists in this path):
 * - Prepare only: read the form without a browser, stage the resume and answers, open nothing.
 * - Fill, I submit: hand the form to a detached helper process (`scout apply-keep-open`, see
 *   `apply-keep-open.ts`) that fills it in the persistent browser, keeps the window open and waits
 *   for the owner's own submit, so the outcome is recorded after the tool and the run have ended.
 *   The tool marks the job `needs-you` ("waiting for you to press submit") and returns at once.
 *   If no helper can be started it falls back to Prepare only and says so.
 * - Automatic: fill, submit, read the confirmation, record `applied` or `unverified`.
 * The apply-mode setting (a digest approval habit) and a per-job approval are not asked for: the
 * level is the owner's decision. "Dry run first" and a failed board self-test are still honoured.
 *
 * Example: `await applyForAutopilot(application, services, { jobId, answers: { notice: "30 days" } })`
 * returns `{ outcome: "applied", status: "applied", message: "...", ... }`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import * as cheerio from "cheerio";
import { canonicalizeUrl } from "../../discovery/index.js";
import { WAITING_FOR_SUBMIT_REASON, returnFromNeedsYou } from "../../ledger/index.js";
import {
  applyModelAnswers,
  detectPageBlocker,
  runApplication,
  snapshotForm,
  type BrowserDriver,
  type FieldMapping,
  type AnswerRules,
  type FillPlan,
  type FormSnapshot,
  type PageBlocker,
  type RefusedAnswer,
  type RunOutcome,
} from "../../apply/index.js";
import type { CredentialVault } from "../../platforms/index.js";
import {
  ScoutError,
  type JobRecord,
  type JobStatus,
  type Profile,
  type Settings,
} from "../../shared/index.js";
import type { Application } from "../application.js";
import { createBoardRunStore } from "../board-runs-store.js";
import { answerRulesFor } from "./apply-answer-rules.js";
import type { ApplyEnvironment } from "./apply-environment.js";
import {
  closeQuietly,
  keepOpen,
  mapForm,
  planForm,
  platformOfAddress,
  trySavedSignIn,
} from "./apply-core.js";
import {
  countAppliedToday,
  effectiveLevel,
  evidenceDirectoryFor,
  findSavedResume,
  jobsFolderOf,
} from "./apply-preparation.js";
import { platformServices } from "./platform-services.js";

/** The outside effects the autopilot apply path needs: the browser and page download, and the keychain. */
export interface AutopilotServices {
  environment: ApplyEnvironment;
  vault: CredentialVault;
}

/** The longest page text handed back by `readFormForAutopilot`, in characters. */
export const FORM_PAGE_TEXT_LIMIT = 4000;

/** Statuses a job may have when the model applies. A `needs-you` job is handed back by the owner (`scout undo`). */
const APPLICABLE_STATUSES: readonly JobStatus[] = ["shortlisted", "resume-ready", "approved"];

/** The reason written when Fill, I submit leaves a filled form for the owner. */
export const WAITING_FOR_OWNER_REASON = WAITING_FOR_SUBMIT_REASON;

/** One field the form still needs an answer for. */
export interface MissingField {
  fieldKey: string;
  label: string;
  reason: string;
}

/** One field Scout filled (or would fill), with where its value came from. */
export interface FilledField {
  fieldKey: string;
  label: string;
  /** `identity`, `answer-bank`, `demographic-setting`, `resume` or `model-answer`. */
  source: string;
}

/** What `applyForAutopilot` returns to the tool. */
export interface AutopilotApplyResult {
  /**
   * How the run ended; `blocked` means answers are still missing and nothing was changed;
   * `waiting-for-you` means a helper window was started and the owner presses submit.
   */
  outcome: RunOutcome | "blocked" | "waiting-for-you";
  /** The job's status after the run, or `waiting-for-you` when a helper window holds the form. */
  status: JobStatus | "waiting-for-you";
  /** A full sentence saying what happened and what comes next. */
  message: string;
  /** The folder holding the evidence, when any was saved. */
  evidencePath?: string;
  /** Required fields still without an answer (set for `blocked`). */
  missingFields: MissingField[];
  /** Fields that were or will be filled. */
  filled: FilledField[];
  /** Model answers that could not be used, with the reason. */
  refusedAnswers: RefusedAnswer[];
  /** Model answers for fields the profile already fills (the profile's value was kept). */
  ignoredAnswers: RefusedAnswer[];
}

/** A form read without a browser, mapped against the profile. */
export interface ReadForm {
  job: JobRecord;
  url: string;
  snapshot: FormSnapshot;
  mappings: FieldMapping[];
  /** The visible text of the page, cut to `FORM_PAGE_TEXT_LIMIT`. Outside text: untrusted. */
  pageText: string;
  /** A sign-in wall, CAPTCHA or similar found in the page, if any. */
  blocker: PageBlocker | undefined;
}

/** Reads the job or throws `not-found`. */
export function requireJob(application: Application, jobId: string): JobRecord {
  const job = application.jobStore.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists. Use the ids the job tools return.`,
    );
  }
  return job;
}

/**
 * The page to read or fill: the job's own link, or `applyUrl` when it is exactly one of the
 * addresses stored for this posting (its canonical link or one of its sources, compared in
 * canonical form). A shared job-board host serves many companies, so a same-site address could
 * send the owner's data to another company's form; only the posting's own addresses are allowed.
 * Failure: `invalid-input` for an address that is not http(s) or is not one of the posting's own.
 */
export function applicationAddress(job: JobRecord, applyUrl: string | undefined): string {
  const checked = (address: string): string => {
    let parsed: URL;
    try {
      parsed = new URL(address);
    } catch {
      throw new ScoutError("invalid-input", `"${address}" is not a web address.`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ScoutError(
        "invalid-input",
        `Scout only opens http or https pages, not "${address}".`,
      );
    }
    return canonicalizeUrl(address);
  };
  const own = checked(job.canonicalUrl);
  if (applyUrl === undefined) return job.canonicalUrl;
  const wanted = checked(applyUrl);
  const known = new Set([own]);
  for (const source of job.sources) {
    try {
      known.add(canonicalizeUrl(source.url));
    } catch {
      // A stored source that is not a web address can never match an applyUrl.
    }
  }
  if (!known.has(wanted)) {
    throw new ScoutError(
      "invalid-input",
      `applyUrl must be one of this posting's own addresses (${job.canonicalUrl}), but it is not. Leave applyUrl out to use the posting's own address; never send the owner's data to another page.`,
    );
  }
  return applyUrl;
}

/** The visible text of an HTML page, tidied and cut. */
function visibleText(html: string): string {
  const page = cheerio.load(html);
  page("script, style, noscript").remove();
  return page("body").text().replace(/\s+/g, " ").trim().slice(0, FORM_PAGE_TEXT_LIMIT);
}

/**
 * Reads the job's application form with a plain download (no browser) and maps it against the
 * profile. A page built by scripts may show no fields; then `snapshot.fields` is empty.
 * Failure: a paused Scout, an unknown job, a missing profile or a page that cannot be downloaded.
 */
export async function readFormForAutopilot(
  application: Application,
  environment: ApplyEnvironment,
  jobId: string,
  applyUrl?: string,
): Promise<ReadForm> {
  application.assertNotPaused();
  const job = requireJob(application, jobId);
  const url = applicationAddress(job, applyUrl);
  const profile = application.profileStore.load();
  const html = await environment.readFormPage(url);
  const snapshot = snapshotForm(html);
  const pageText = visibleText(html);
  return {
    job,
    url,
    snapshot,
    mappings: mapForm(snapshot, profile, application.settingsStore.load()),
    pageText,
    blocker: detectPageBlocker(pageText, html),
  };
}

/**
 * A resume file the model named, proven to be a PDF inside this job's own folder or the data
 * folder's `resumes` folder, so a model can never make Scout upload some other file.
 */
export function checkedResumePath(application: Application, path: string): string {
  const resolved = resolve(path);
  const allowedFolders = [jobsFolderOf(application), join(application.directory, "resumes")];
  const inside = allowedFolders.some((folder) => resolved.startsWith(resolve(folder) + sep));
  if (!inside || !resolved.toLowerCase().endsWith(".pdf") || !existsSync(resolved)) {
    throw new ScoutError(
      "invalid-input",
      "resumePath must be an existing PDF made by build_resume (inside Scout's jobs or resumes folder). Call build_resume and use the path it returns.",
    );
  }
  return resolved;
}

/** Everything one run knows once the job, settings and level are settled. */
export interface RunContext {
  application: Application;
  services: AutopilotServices;
  job: JobRecord;
  settings: Settings;
  profile: Profile;
  level: ReturnType<typeof effectiveLevel>;
  /** Set when the owner chose Automatic but the level was held back (a failed board self-test). */
  levelNote: string;
  boardHasCleanRun: boolean;
  recordCleanDryRun: () => void;
  url: string;
  resumeFile: string | undefined;
  evidenceDirectory: string;
  answers: Record<string, string>;
  /** What every model answer must pass: the owner's `neverUsed` list and the profile's facts. */
  answerRules: AnswerRules;
  /** True once Scout has begun to shut down (the run was stopped); a submit is then never started. */
  shouldStop: () => boolean;
}

/** Throws the apply module's own refusals before anything is opened. */
function requireApplicable(job: JobRecord): void {
  if (job.status === "submitting") {
    throw new ScoutError(
      "unsafe",
      `Job ${job.id} is already being submitted, or a submit was interrupted. Scout never retries a submit blindly; ask the owner to check the company's page and email.`,
    );
  }
  if (!APPLICABLE_STATUSES.includes(job.status)) {
    throw new ScoutError(
      "invalid-input",
      `Job ${job.id} is "${job.status}", so it cannot be applied for now. Only shortlisted, resume-ready or approved jobs can be applied for; a submitted job is never submitted twice.`,
    );
  }
}

/** The fields a plan fills, with the source of each value. */
function filledFields(plan: FillPlan, mappings: FieldMapping[]): FilledField[] {
  const sourceOf = new Map(
    mappings.map((mapping) => [mapping.field.key, mapping.source ?? "unknown"]),
  );
  return plan.actions.map((action) => ({
    fieldKey: action.fieldKey,
    label: action.label,
    source: sourceOf.get(action.fieldKey) ?? "unknown",
  }));
}

/**
 * Saves what the model answered next to the evidence: every value typed (a file by name), where it
 * came from, and the answers that were refused or ignored. The evidence folder also holds the form
 * as it was seen, so a later reader can compare question and answer.
 */
export function saveAnswers(
  context: RunContext,
  plan: FillPlan,
  mappings: FieldMapping[],
  refused: RefusedAnswer[],
  ignored: RefusedAnswer[],
): void {
  const sourceOf = new Map(
    mappings.map((mapping) => [mapping.field.key, mapping.source ?? "unknown"]),
  );
  const values: Record<string, { label: string; value: string; source: string }> = {};
  for (const action of plan.actions) {
    values[action.fieldKey] = {
      label: action.label,
      value:
        action.kind === "upload" ? (action.value.split(sep).pop() ?? action.value) : action.value,
      source: sourceOf.get(action.fieldKey) ?? "unknown",
    };
  }
  mkdirSync(context.evidenceDirectory, { recursive: true });
  writeFileSync(
    join(context.evidenceDirectory, "answers.json"),
    `${JSON.stringify({ url: plan.url, formShapeHash: plan.snapshot.hash, values, refused, ignored }, null, 2)}\n`,
    "utf8",
  );
}

/** Builds the result value, adding the evidence folder when it exists. */
export function report(
  context: RunContext,
  outcome: AutopilotApplyResult["outcome"],
  message: string,
  parts: Partial<AutopilotApplyResult> = {},
): AutopilotApplyResult {
  const status = context.application.jobStore.get(context.job.id)?.status ?? context.job.status;
  return {
    outcome,
    status,
    message,
    ...(existsSync(context.evidenceDirectory) ? { evidencePath: context.evidenceDirectory } : {}),
    missingFields: [],
    filled: [],
    refusedAnswers: [],
    ignoredAnswers: [],
    ...parts,
  };
}

/** Opens the application page and reads its text and HTML. A failure leaves the job unchanged. */
async function openAndRead(
  driver: BrowserDriver,
  url: string,
): Promise<{ pageText: string; pageHtml: string }> {
  try {
    await driver.open(url);
    return { pageText: await driver.pageText(), pageHtml: await driver.pageHtml() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ScoutError(
      "unavailable",
      `Scout could not open ${url} (${detail}). Nothing was filled and the job is unchanged.`,
    );
  }
}

/** Records a page that needs the owner (or is closed) and says so. A login wall names `scout login`. */
function stopForPage(
  context: RunContext,
  blocker: PageBlocker,
  signInNote: string | undefined,
): AutopilotApplyResult {
  const platform = platformOfAddress(context.url);
  const command = platform === undefined ? "scout login <platform>" : `scout login ${platform}`;
  const reason =
    blocker.kind === "login"
      ? `${blocker.reason} Sign in with \`${command}\`, then put the job back with \`scout undo ${context.job.id}\`.${signInNote === undefined ? "" : ` ${signInNote}`}`
      : blocker.reason;
  const closed = blocker.kind === "closed";
  context.application.jobStore.transition(context.job.id, closed ? "closed" : "needs-you", reason);
  return report(context, closed ? "closed" : "needs-you", reason);
}

/**
 * Level Prepare only: no browser. Reads the form with a plain download when it can, saves a staging
 * note in the evidence folder and leaves the job as it was (unless a question only the owner may
 * answer is on the form: then the job goes to `needs-you`).
 */
async function prepareOnly(context: RunContext): Promise<AutopilotApplyResult> {
  const { application, services, answers } = context;
  let html: string;
  try {
    html = await services.environment.readFormPage(context.url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    mkdirSync(context.evidenceDirectory, { recursive: true });
    writeFileSync(
      join(context.evidenceDirectory, "staged-application.json"),
      `${JSON.stringify({ url: context.url, resume: context.resumeFile ?? null, answers }, null, 2)}\n`,
      "utf8",
    );
    return report(
      context,
      "staged",
      `Prepare only: the form could not be read without a browser (${detail}), so the resume and your answers are staged and the owner submits by hand.`,
    );
  }
  const snapshot = snapshotForm(html);
  const given = applyModelAnswers(
    mapForm(snapshot, context.profile, context.settings),
    answers,
    context.answerRules,
  );
  const plan = planForm(context.url, snapshot, given.mappings, context.resumeFile);
  const parts = {
    filled: filledFields(plan, given.mappings),
    refusedAnswers: given.refused,
    ignoredAnswers: given.ignored,
  };
  if (plan.blockers.length > 0) return blockedResult(context, plan, parts);
  saveAnswers(context, plan, given.mappings, given.refused, given.ignored);
  writeFileSync(
    join(context.evidenceDirectory, "staged-application.json"),
    `${JSON.stringify({ url: context.url, resume: context.resumeFile ?? null, fieldsReady: plan.actions.length }, null, 2)}\n`,
    "utf8",
  );
  application.actionLog.append({
    actor: "autopilot",
    action: "apply-staged",
    jobId: context.job.id,
    detail: "Staged the resume and answers at level Prepare only.",
  });
  return report(
    context,
    "staged",
    "Prepare only: the resume and answers are staged in the job folder and no browser was opened. The owner submits by hand.",
    parts,
  );
}

/**
 * The result when the plan has blockers. A required question only the owner may answer (legal,
 * salary, personal, or demographic when the setting is "ask each time") moves the job to `needs-you`
 * with the question, whatever answer the model gave. Otherwise nothing changes and the model must
 * answer the listed fields and call again.
 */
export function blockedResult(
  context: RunContext,
  plan: FillPlan,
  parts: Partial<AutopilotApplyResult>,
): AutopilotApplyResult {
  const missingFields = plan.blockers.map((blocker) => ({
    fieldKey: blocker.fieldKey,
    label: blocker.label,
    reason: blocker.reason,
  }));
  const ownerOnly = plan.blockers.filter((blocker) => blocker.status === "needs-you");
  if (ownerOnly.length > 0) {
    const questions = ownerOnly.map((blocker) => `"${blocker.label}"`).join(", ");
    const reason = `The form asks ${ownerOnly.length === 1 ? "a question" : "questions"} only you can answer: ${questions}. Scout never lets the model answer legal, salary, personal or (when your setting is ask each time) demographic questions. Answer on the form yourself, or add an approved answer to your profile, then put the job back with \`scout undo ${context.job.id}\`.`;
    context.application.jobStore.transition(context.job.id, "needs-you", reason);
    return report(context, "needs-you", reason, { ...parts, missingFields });
  }
  return report(
    context,
    "blocked",
    `The form still needs ${missingFields.length} answer(s): ${missingFields.map((field) => field.label).join(", ")}. Nothing was filled or changed. Call apply_to_job again with an answer for each key in missingFields.`,
    { ...parts, missingFields },
  );
}

/**
 * The settings `runApplication` sees. At Automatic the apply-mode habit is not asked again (the
 * level is the owner's decision, D-013). At Fill nothing is submitted by Scout, so "dry run first"
 * (which guards Scout's own submits on a new board) must not turn the fill into a dry run.
 */
function settingsForLevel(settings: Settings, level: RunContext["level"]): Settings {
  if (level === "auto") return { ...settings, applyMode: "auto" };
  if (level === "fill") return { ...settings, dryRunFirst: false };
  return settings;
}

/**
 * The arguments `runApplication` takes in this path. At Automatic the submit marker also claims
 * today's limit in one transaction, and a submit is never started once Scout is shutting down.
 */
export function runArguments(
  context: RunContext,
  plan: FillPlan,
  driver: BrowserDriver,
  level: RunContext["level"],
) {
  const { application } = context;
  return {
    driver,
    plan,
    level,
    mode: "live" as const,
    settings: settingsForLevel(context.settings, level),
    jobs: application.jobStore,
    jobId: context.job.id,
    appliedToday: () => countAppliedToday(application.actionLog, application.now()),
    boardHasCleanRun: context.boardHasCleanRun,
    now: () => application.now(),
    profileVersion: context.profile.version,
    evidenceDirectory: context.evidenceDirectory,
    beforeSubmit: () => {
      application.assertNotPaused();
      if (context.shouldStop()) {
        throw new ScoutError(
          "paused",
          "Scout is stopping, so the application was not submitted. The form is untouched; the job can be applied for again later.",
        );
      }
    },
    ...(level === "auto"
      ? {
          markSubmitting: (reason: string) =>
            application.claimSubmitSlot(
              context.job.id,
              reason,
              context.settings.dailyApplicationLimit,
            ),
        }
      : {}),
    requireNewConfirmation: true,
  };
}

/** Moves the job to the status `runApplication` needs: `approved` to submit, `resume-ready` to fill. */
export function readyJobForRun(context: RunContext): void {
  const { jobStore } = context.application;
  const current = jobStore.get(context.job.id)?.status;
  const target: JobStatus = context.level === "auto" ? "approved" : "resume-ready";
  if (current === target || current === "approved") return;
  jobStore.transition(
    context.job.id,
    target,
    context.level === "auto"
      ? "Autopilot chose to apply and the board is set to Automatic."
      : "Autopilot chose to apply and the board is set to Fill, I submit.",
  );
}

/** A page opened, checked and planned: ready to fill. */
export interface PlannedForm {
  plan: FillPlan;
  mappings: FieldMapping[];
  refused: RefusedAnswer[];
  ignored: RefusedAnswer[];
  parts: Pick<AutopilotApplyResult, "filled" | "refusedAnswers" | "ignoredAnswers">;
}

/**
 * Opens the application page in `driver`, signs in once when the owner chose saved credentials,
 * and plans the fill from the owner's profile and the model's answers. Returns the plan, or the
 * already recorded result when the page needs the owner (sign-in wall, CAPTCHA, closed job) or the
 * plan still has blockers.
 */
export async function openAndPlan(
  context: RunContext,
  driver: BrowserDriver,
): Promise<PlannedForm | AutopilotApplyResult> {
  const { application, services, settings } = context;
  let page = await openAndRead(driver, context.url);
  let blocker = detectPageBlocker(page.pageText, page.pageHtml);
  let signInNote: string | undefined;
  if (blocker?.kind === "login") {
    const attempt = await trySavedSignIn({
      application,
      settings,
      platforms: platformServices(application, services.environment, services.vault),
      driver,
      url: context.url,
      jobId: context.job.id,
      say: () => {},
    });
    signInNote = attempt.note;
    if (attempt.signedIn) {
      page = await openAndRead(driver, context.url);
      blocker = detectPageBlocker(page.pageText, page.pageHtml);
    }
  }
  if (blocker !== undefined) return stopForPage(context, blocker, signInNote);

  const snapshot = snapshotForm(page.pageHtml);
  const given = applyModelAnswers(
    mapForm(snapshot, context.profile, settings),
    context.answers,
    context.answerRules,
  );
  const plan = planForm(context.url, snapshot, given.mappings, context.resumeFile);
  const parts = {
    filled: filledFields(plan, given.mappings),
    refusedAnswers: given.refused,
    ignoredAnswers: given.ignored,
  };
  if (plan.blockers.length > 0) return blockedResult(context, plan, parts);
  return {
    plan,
    mappings: given.mappings,
    refused: given.refused,
    ignored: given.ignored,
    parts,
  };
}

/** True when `openAndPlan` returned a plan (not an already recorded result). */
export function isPlannedForm(value: PlannedForm | AutopilotApplyResult): value is PlannedForm {
  return "plan" in value;
}

/** Level Automatic: open the browser, check the page, fill, submit once, and record the outcome. */
async function fillAndSubmit(context: RunContext): Promise<AutopilotApplyResult> {
  const { application, services } = context;
  const driver = await services.environment.openBrowser({
    profileDirectory: join(application.directory, "browser-profile"),
    headless: false,
  });
  try {
    const planned = await openAndPlan(context, driver);
    if (!isPlannedForm(planned)) return planned;
    const { plan, mappings, refused, ignored, parts } = planned;

    readyJobForRun(context);
    const run = await runApplication(runArguments(context, plan, keepOpen(driver), context.level));
    saveAnswers(context, plan, mappings, refused, ignored);

    if (run.outcome === "dry-run-complete" && run.cleanFill) {
      context.recordCleanDryRun();
      return report(
        context,
        "dry-run-complete",
        'Dry run finished: this board has no clean run yet and "dry run first" is on, so the form was filled and checked but not submitted. Call apply_to_job again with the same answers to submit.',
        parts,
      );
    }
    return report(context, run.outcome, run.reason, parts);
  } finally {
    await closeQuietly(driver);
  }
}

/** The folder, inside the data folder, where hand-off files and helper locks live. */
export function helperFolderOf(application: Pick<Application, "directory">): string {
  return join(application.directory, "apply-helpers");
}

/** A job id made safe to use in a file name. */
export function helperFileStem(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** What the tool leaves for the helper: the model's answers and the choices it made. */
export interface HelperHandOff {
  answers: Record<string, string>;
  resumePath?: string;
  applyUrl?: string;
}

/** The file the helper reads its hand-off from. */
export function handOffPathOf(application: Pick<Application, "directory">, jobId: string): string {
  return join(helperFolderOf(application), `${helperFileStem(jobId)}.json`);
}

/** The lock file that says a helper owns this job's window. */
export function lockPathOf(application: Pick<Application, "directory">, jobId: string): string {
  return join(helperFolderOf(application), `${helperFileStem(jobId)}.lock`);
}

/** True when `processId` is a running process (signal 0 only checks). */
export function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** True when a helper that is still running holds this job's window. */
export function helperIsRunning(
  application: Pick<Application, "directory">,
  jobId: string,
): boolean {
  const lockPath = lockPathOf(application, jobId);
  if (!existsSync(lockPath)) return false;
  try {
    const held = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof held.pid === "number" && processIsRunning(held.pid);
  } catch {
    return false;
  }
}

/**
 * Level Fill, I submit: validates what a plain download can show, then hands the form to a
 * detached helper that fills it, keeps the window open and records the owner's own submit. The job
 * goes to `needs-you` ("waiting for you to press submit") at once and the tool returns. When no
 * helper can be started the job is put back and the run falls back to Prepare only, saying so.
 */
async function handOffToHelper(context: RunContext): Promise<AutopilotApplyResult> {
  const { application, services } = context;
  if (helperIsRunning(application, context.job.id)) {
    throw new ScoutError(
      "unsafe",
      `A browser window for job ${context.job.id} is already open, waiting for the owner to press submit. Scout will not open a second one.`,
    );
  }
  let blockedAlready: AutopilotApplyResult | undefined;
  try {
    const snapshot = snapshotForm(await services.environment.readFormPage(context.url));
    if (snapshot.fields.length > 0) {
      const given = applyModelAnswers(
        mapForm(snapshot, context.profile, context.settings),
        context.answers,
        context.answerRules,
      );
      const plan = planForm(context.url, snapshot, given.mappings, context.resumeFile);
      if (plan.blockers.length > 0) {
        blockedAlready = blockedResult(context, plan, {
          filled: filledFields(plan, given.mappings),
          refusedAnswers: given.refused,
          ignoredAnswers: given.ignored,
        });
      }
    }
  } catch {
    // A page that cannot be downloaded or has no fields is checked by the helper's browser.
  }
  if (blockedAlready !== undefined) return blockedAlready;

  const handOff: HelperHandOff = {
    answers: context.answers,
    ...(context.resumeFile === undefined ? {} : { resumePath: context.resumeFile }),
    ...(context.url === context.job.canonicalUrl ? {} : { applyUrl: context.url }),
  };
  const handOffPath = handOffPathOf(application, context.job.id);
  mkdirSync(helperFolderOf(application), { recursive: true });
  writeFileSync(handOffPath, `${JSON.stringify(handOff, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  application.jobStore.transition(context.job.id, "needs-you", WAITING_FOR_OWNER_REASON);
  try {
    await services.environment.startHelper({
      args: ["apply-keep-open", context.job.id, "--answers-file", handOffPath],
      dataDirectory: resolve(application.directory),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    rmSync(handOffPath, { force: true });
    returnFromNeedsYou(
      application.jobStore,
      context.job.id,
      "The helper window could not be started, so the job was put back.",
    );
    const staged = await prepareOnly(context);
    return {
      ...staged,
      message: `A separate window that waits for the owner could not be started (${detail}), so this fell back to Prepare only. ${staged.message}`,
    };
  }
  application.actionLog.append({
    actor: "autopilot",
    action: "apply-handed-off",
    jobId: context.job.id,
    detail: "Started a helper that fills the form and waits for the owner to press submit.",
  });
  return {
    outcome: "waiting-for-you",
    status: "waiting-for-you",
    message: `A browser window is being opened by a separate helper that fills the form, keeps it open and records the result when the owner presses submit. Scout does not submit at this level. The job is marked needs-you (${WAITING_FOR_OWNER_REASON}). Do not call apply_to_job for it again.${context.levelNote}`,
    missingFields: [],
    filled: [],
    refusedAnswers: [],
    ignoredAnswers: [],
  };
}

/** What `applyForAutopilot` needs from the model. */
export interface AutopilotApplyInput {
  jobId: string;
  /** Answers by field key (the keys `get_form` lists). */
  answers: Record<string, string>;
  /** A PDF made by `build_resume`; default: the job folder's tailored resume. */
  resumePath?: string;
  /** The application page when it differs from the job's link; it must be one of the posting's own addresses. */
  applyUrl?: string;
  /** True once the server has begun to stop; a submit is then never started. Default: never. */
  shouldStop?: () => boolean;
}

/**
 * Builds everything one run knows. `forcedLevel` is for the helper, which always fills and never
 * submits whatever the settings say now.
 */
export function buildRunContext(
  application: Application,
  services: AutopilotServices,
  job: JobRecord,
  input: Omit<AutopilotApplyInput, "jobId">,
  forcedLevel?: RunContext["level"],
): RunContext {
  const settings = application.settingsStore.load();
  const profile = application.profileStore.load();
  const runs = createBoardRunStore(join(application.directory, "board-runs.json"));
  const level =
    forcedLevel ??
    effectiveLevel({
      settings,
      level: settings.boardLevels[job.board] ?? "prepare",
      boardSelfTestFailed: runs.hasFailedSelfTest(job.board),
    });
  return {
    application,
    services,
    job,
    settings,
    profile,
    level,
    levelNote:
      settings.boardLevels[job.board] === "auto" && level === "fill"
        ? " The board is set to Automatic, but its latest self-test failed, so it is held back to Fill, I submit."
        : "",
    boardHasCleanRun: runs.hasCleanRun(job.board),
    recordCleanDryRun: () => runs.recordCleanDryRun(job.board, application.now()),
    url: applicationAddress(job, input.applyUrl),
    resumeFile:
      input.resumePath === undefined
        ? findSavedResume(application, job)
        : checkedResumePath(application, input.resumePath),
    evidenceDirectory: evidenceDirectoryFor(application, job),
    answers: input.answers,
    answerRules: answerRulesFor(profile, job),
    shouldStop: input.shouldStop ?? (() => false),
  };
}

/**
 * Applies to one job as far as the owner's level for its board allows. See the file comment for
 * what each level does. Order of the refusals, all before any page opens: the kill switch, the
 * job's status, the daily limit (when a submit could happen), the resume file.
 * Failure: a `ScoutError` (paused, not-found, unsafe, invalid-input, limit-reached, unavailable).
 */
export async function applyForAutopilot(
  application: Application,
  services: AutopilotServices,
  input: AutopilotApplyInput,
): Promise<AutopilotApplyResult> {
  application.assertNotPaused();
  const job = requireJob(application, input.jobId);
  requireApplicable(job);
  const context = buildRunContext(application, services, job, input);
  const { settings, level } = context;
  const dryRun = settings.dryRunFirst && !context.boardHasCleanRun;
  if (
    level === "auto" &&
    !dryRun &&
    countAppliedToday(application.actionLog, application.now()) >= settings.dailyApplicationLimit
  ) {
    throw new ScoutError(
      "limit-reached",
      `Today's limit of ${settings.dailyApplicationLimit} applications is reached, so Scout will not submit another one until tomorrow.`,
    );
  }
  application.actionLog.append({
    actor: "autopilot",
    action: "apply-start",
    jobId: job.id,
    detail: `Applying at level ${level} on ${job.board}.`,
  });
  if (level === "prepare") return prepareOnly(context);
  if (level === "fill") return handOffToHelper(context);
  return fillAndSubmit(context);
}
