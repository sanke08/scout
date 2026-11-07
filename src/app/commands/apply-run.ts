/**
 * `scout apply <jobId>`: gathers everything the apply module needs, prints the plan, and calls
 * `runApplication`, the only code in Scout that may press a submit button.
 *
 * Why it exists: Scenario I and J. The command decides nothing about safety itself; it feeds the
 * module the facts (kill switch, level, dry run, daily count, clean-run record) and shows the user
 * what will happen. Order, as in the apply module: kill switch first, then the job, then the level,
 * then the daily limit, then the resume, and only then a page. At level Prepare only no browser is
 * ever opened. At level Automatic the user must type `yes` for this job, and nothing else lets the
 * final click happen. A run that waits for the user to press submit records `applied` only with
 * confirmation text from the page, otherwise `unverified`.
 *
 * Honest status: the real browser path is untested against a real browser; every test uses the
 * apply module's fake driver on saved fictional forms.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  detectPageBlocker,
  confirmationIsNew,
  mapFields,
  mayAutoSubmit,
  planApplication,
  runApplication,
  saveEvidence,
  snapshotForm,
  type BrowserDriver,
  type FillPlan,
  type RunResult,
} from "../../apply/index.js";
import { ScoutError, type JobRecord, type Profile, type Settings } from "../../shared/index.js";
import type { Application } from "../application.js";
import { createBoardRunStore, type BoardRunStore } from "../board-runs-store.js";
import type { ApplyEnvironment } from "./apply-environment.js";
import {
  LEVEL_NAMES,
  countAppliedToday,
  describePlan,
  describeSubmission,
  effectiveLevel,
  evidenceDirectoryFor,
  explainHeldBack,
  findOrBuildResume,
  type LevelConditions,
} from "./apply-preparation.js";

/** The options of `scout apply` as commander hands them over. */
export interface ApplyCommandOptions {
  /** The application page, when it differs from the job's own address. */
  url?: string;
  /** Fill and check everything, submit nothing. */
  dryRun?: boolean;
  /** Folder of Scout's own browser profile. Default: `<data>/browser-profile`. */
  profileDir?: string;
  /** Seconds to wait for the confirmation page after the user presses submit. `0` means do not wait. */
  wait?: string;
}

/** How long to wait for the user to press submit when `--wait` is not given (ten minutes). */
export const DEFAULT_WAIT_SECONDS = 600;

/** How long Scout pauses between two looks at the page while waiting for the confirmation. */
const POLL_MILLISECONDS = 3000;

/** Everything one apply run knows, gathered once so the steps below take one argument. */
interface ApplyContext {
  application: Application;
  environment: ApplyEnvironment;
  job: JobRecord;
  settings: Settings;
  profile: Profile;
  runs: BoardRunStore;
  /** The level after the board's self-test record is applied. */
  level: ReturnType<typeof effectiveLevel>;
  /** The user asked for a dry run with `--dry-run`. */
  explicitDryRun: boolean;
  /** True when this run is a dry run for any reason (asked for, or a new board with dry-run-first on). */
  dryRun: boolean;
  /** True when the board has a clean-run record. */
  boardHasCleanRun: boolean;
  /** True when the apply module would be allowed to submit in this run. */
  submitPossible: boolean;
  url: string;
  resumeFile: string;
  evidenceDirectory: string;
  profileDirectory: string;
  waitSeconds: number;
}

/** Reads the job and refuses one that cannot be applied for, before anything is opened. */
function loadApplicableJob(application: Application, jobId: string): JobRecord {
  const job = application.jobStore.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists. Run \`scout jobs\` to see the ids that do.`,
    );
  }
  if (job.status === "submitting") {
    throw new ScoutError(
      "unsafe",
      `Job ${jobId} is already being submitted, or a submit was interrupted. Scout never retries a submit blindly; check the company's page and your email, then mark the job yourself.`,
    );
  }
  if (job.status !== "resume-ready" && job.status !== "approved") {
    throw new ScoutError(
      "invalid-input",
      `Job ${jobId} is "${job.status}", but applying needs it to be "resume-ready" or "approved". Run \`scout jobs\` to see where it stands.`,
    );
  }
  return job;
}

/** Reads `--wait`: a whole number of seconds, default ten minutes. */
function parseWaitSeconds(text: string | undefined): number {
  if (text === undefined) return DEFAULT_WAIT_SECONDS;
  const seconds = Number(text);
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new ScoutError(
      "invalid-input",
      `--wait needs a whole number of seconds (0 or more), but you gave "${text}".`,
    );
  }
  return seconds;
}

/** Reads `--url`: an http or https address, or the job's own address when none is given. */
function parseApplicationUrl(text: string | undefined, job: JobRecord): string {
  const address = text ?? job.canonicalUrl;
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    throw new ScoutError(
      "invalid-input",
      `"${address}" is not a web address. Give the application page with --url, for example https://example.com/jobs/1/apply.`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ScoutError(
      "invalid-input",
      `Scout only opens http or https pages, not "${address}".`,
    );
  }
  return address;
}

/** The short reason text of an error, for a sentence that says what went wrong. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the form into a plan: snapshot, mapping with the answer bank, then planning. */
function buildPlan(html: string, context: ApplyContext): FillPlan {
  const snapshot = snapshotForm(html);
  const mappings = mapFields(
    snapshot,
    context.profile,
    context.profile.answerBank,
    context.settings,
  );
  return planApplication({
    url: context.url,
    snapshot,
    mappings,
    resumeFilePath: context.resumeFile,
  });
}

/** A driver that refuses every call. Level Prepare passes it so a bug could never open a page. */
function refusingDriver(): BrowserDriver {
  const refuse = async (): Promise<never> => {
    throw new ScoutError(
      "unsafe",
      "A browser was used at level Prepare only, which must never open a page.",
    );
  };
  return {
    open: refuse,
    pageText: refuse,
    pageHtml: refuse,
    fill: refuse,
    select: refuse,
    upload: refuse,
    readValue: refuse,
    screenshot: refuse,
    submit: refuse,
    readConfirmation: refuse,
    close: async () => {},
  };
}

/**
 * The same driver with `close` doing nothing, so the window stays open after `runApplication`
 * (which closes its driver) and the user can press submit. The command closes the real one.
 */
function keepOpen(driver: BrowserDriver): BrowserDriver {
  return { ...driver, close: async () => {} };
}

/** Closes a driver, ignoring a failure: the result of the run is already decided. */
async function closeQuietly(driver: BrowserDriver): Promise<void> {
  try {
    await driver.close();
  } catch {
    // The window may already be gone.
  }
}

/** Prints what a finished run did, in the module's own words. */
function printResult(result: RunResult, context: ApplyContext): void {
  console.log("");
  console.log(`Outcome: ${result.outcome}. ${result.reason}`);
  console.log(`Job status: ${result.jobStatus}.`);
  if (existsSync(context.evidenceDirectory)) {
    console.log(`Evidence saved in ${context.evidenceDirectory}`);
  }
}

/** The arguments `runApplication` takes, the same for every level. */
function runArguments(
  context: ApplyContext,
  driver: BrowserDriver,
  plan: FillPlan,
  level: LevelConditions["level"],
) {
  return {
    driver,
    plan,
    level,
    mode: context.explicitDryRun ? ("dry-run" as const) : ("live" as const),
    settings: context.settings,
    jobs: context.application.jobStore,
    jobId: context.job.id,
    appliedToday: () => countAppliedToday(context.application.actionLog, context.application.now()),
    boardHasCleanRun: context.boardHasCleanRun,
    now: () => context.application.now(),
    profileVersion: context.profile.version,
    evidenceDirectory: context.evidenceDirectory,
  };
}

/** Level Prepare only: no browser. Reads the form with a plain download when it can, prints, stages. */
async function stageOnly(context: ApplyContext): Promise<void> {
  console.log("Prepare only: Scout opens no browser and fills nothing.");
  let plan: FillPlan | undefined;
  try {
    plan = buildPlan(await context.environment.readFormPage(context.url), context);
  } catch (error) {
    console.log(
      `Scout could not read the form without a browser (${detailOf(error)}), so the fields are not listed.`,
    );
  }
  if (plan !== undefined) {
    for (const line of describePlan(plan)) console.log(line);
    const result = await runApplication(runArguments(context, refusingDriver(), plan, "prepare"));
    printResult(result, context);
  }
  console.log(
    `Next: open ${context.url}, attach the resume ${context.resumeFile}, and submit by hand.`,
  );
}

/** A page that needs the user (or is closed): record it, say so, and for a sign-in wall keep the window open. */
async function stopForPage(
  context: ApplyContext,
  blocker: NonNullable<ReturnType<typeof detectPageBlocker>>,
): Promise<void> {
  const { jobStore } = context.application;
  jobStore.transition(
    context.job.id,
    blocker.kind === "closed" ? "closed" : "needs-you",
    blocker.reason,
  );
  console.log(`Stopped: ${blocker.reason}`);
  if (blocker.kind === "login") {
    console.log(
      "Sign in yourself in the open browser window; Scout never types a password. The session stays in Scout's own browser profile.",
    );
    await context.environment.readLine(
      `Press Enter here when you are done, then run \`scout undo ${context.job.id}\` and \`scout apply ${context.job.id}\` again. `,
    );
  }
}

/**
 * Looks at the page until a real confirmation message appears or the time is up.
 * Example: a page that shows "Thank you for applying!" on the second look returns that text; a page
 * that never does returns `undefined` after `timeoutSeconds`.
 */
async function waitForConfirmation(
  driver: BrowserDriver,
  environment: ApplyEnvironment,
  timeoutSeconds: number,
): Promise<string | undefined> {
  const readPageText = async (): Promise<string> => {
    try {
      return await driver.readConfirmation();
    } catch {
      // The page may be between two loads; look again on the next round.
      return "";
    }
  };
  // Text already on the form before the user submits (for example a banner saying "your
  // application has been received" on a re-opened form) must never count as a confirmation.
  const textBeforeSubmit = await readPageText();
  let waitedMilliseconds = 0;
  for (;;) {
    const text = await readPageText();
    if (confirmationIsNew(textBeforeSubmit, text)) {
      return text;
    }
    if (waitedMilliseconds >= timeoutSeconds * 1000) return undefined;
    await environment.pause(POLL_MILLISECONDS);
    waitedMilliseconds += POLL_MILLISECONDS;
  }
}

/** Saves the final evidence after the user's own submit. A failure here is reported, never hidden. */
async function saveFinalEvidence(
  context: ApplyContext,
  driver: BrowserDriver,
  plan: FillPlan,
  startedAt: string,
  confirmationText: string | undefined,
  outcome: string,
): Promise<void> {
  const beforePath = join(context.evidenceDirectory, "screenshot-before-submit.png");
  const filledValues: Record<string, string> = {};
  for (const action of plan.actions) filledValues[action.fieldKey] = action.value;
  try {
    const screenshotAfterSubmit = await driver.screenshot();
    saveEvidence(context.evidenceDirectory, {
      snapshot: plan.snapshot,
      filledValues,
      ...(existsSync(beforePath) ? { screenshotBeforeSubmit: readFileSync(beforePath) } : {}),
      screenshotAfterSubmit,
      ...(confirmationText === undefined ? {} : { confirmationText }),
      startedAt,
      finishedAt: context.application.now().toISOString(),
      profileVersion: context.profile.version,
      outcome,
    });
  } catch (error) {
    console.log(
      `Scout could not save the final evidence (${detailOf(error)}). The status is recorded.`,
    );
  }
}

/**
 * Level Fill, I submit (also Automatic when held back): the window stays open, the user presses
 * submit, and Scout records what the page shows. `applied` needs confirmation text; anything else is
 * `unverified`. The submit marker is set only now, after the user's own click may have happened, so
 * an unclear result is never retried.
 */
async function waitForUserSubmit(
  context: ApplyContext,
  driver: BrowserDriver,
  plan: FillPlan,
  startedAt: string,
): Promise<void> {
  if (context.waitSeconds === 0) {
    console.log(
      "The form is filled. Not waiting (--wait 0): the browser window closes now and the job is unchanged. Nothing was submitted.",
    );
    return;
  }
  console.log(
    `The form is filled in the open browser window. Review it and press submit yourself; Scout waits up to ${context.waitSeconds} seconds for the confirmation page.`,
  );
  const { jobStore } = context.application;
  const id = context.job.id;
  if (jobStore.get(id)?.status === "resume-ready") {
    jobStore.transition(
      id,
      "approved",
      "The form was filled and left open for you to submit, so the job is recorded as approved to track the outcome.",
    );
  }
  jobStore.transition(
    id,
    "submitting",
    "Submit marker: the form was filled and left open for you to submit; written before waiting so an unclear result is never retried.",
  );
  const confirmation = await waitForConfirmation(driver, context.environment, context.waitSeconds);
  if (confirmation !== undefined) {
    jobStore.transition(
      id,
      "applied",
      "The page showed a confirmation message after you submitted, so the application is recorded as applied.",
    );
    console.log("A confirmation message was seen, so the job is recorded as applied.");
  } else {
    jobStore.transition(
      id,
      "unverified",
      `No confirmation message was seen within ${context.waitSeconds} seconds, so it is not known whether the application was sent. Scout will not retry; check the company's page and your email.`,
    );
    console.log(
      "No confirmation message was seen, so the job is recorded as unverified. Check the company's page and your email; Scout will not retry.",
    );
  }
  await saveFinalEvidence(
    context,
    driver,
    plan,
    startedAt,
    confirmation,
    confirmation === undefined ? "unverified" : "applied",
  );
}

/**
 * At level Automatic with every condition met, shows the exact summary and asks for a typed `yes`.
 * Returns true only for exactly that. Anything else keeps the run at Fill, I submit.
 */
async function confirmSubmission(context: ApplyContext, plan: FillPlan): Promise<boolean> {
  console.log("");
  for (const line of describeSubmission(plan, context.job)) console.log(line);
  const answer = await context.environment.readLine(
    'Type "yes" to let Scout press submit for this job. Anything else keeps this at Fill, I submit: ',
  );
  const confirmed = answer.trim().toLowerCase() === "yes";
  if (!confirmed) console.log("Not confirmed, so Scout will fill the form and you press submit.");
  return confirmed;
}

/** Opens the page with the driver, checks it, plans, confirms (Automatic only), runs and records. */
async function applyWithDriver(context: ApplyContext, driver: BrowserDriver): Promise<void> {
  const startedAt = context.application.now().toISOString();
  let pageText: string;
  let pageHtml: string;
  try {
    await driver.open(context.url);
    pageText = await driver.pageText();
    pageHtml = await driver.pageHtml();
  } catch (error) {
    throw new ScoutError(
      "unavailable",
      `Scout could not open ${context.url} (${detailOf(error)}). Nothing was filled and the job is unchanged.`,
    );
  }
  const blocker = detectPageBlocker(pageText, pageHtml);
  if (blocker !== undefined) {
    await stopForPage(context, blocker);
    return;
  }

  const plan = buildPlan(pageHtml, context);
  console.log("");
  for (const line of describePlan(plan)) console.log(line);
  console.log("");

  const mayAsk = context.submitPossible && plan.blockers.length === 0;
  const confirmed = mayAsk && (await confirmSubmission(context, plan));
  // Whenever a submit would be possible, only a typed yes keeps level Automatic; otherwise fill.
  // The job status can change while the page opens (for example approved in the digest), so a
  // submit is never allowed without a typed yes, whatever submitPossible said earlier.
  const level = confirmed ? context.level : "fill";
  // The typed yes can take a long time; the kill switch is checked again right before the click.
  if (confirmed) context.application.assertNotPaused();
  const result = await runApplication(runArguments(context, keepOpen(driver), plan, level));
  printResult(result, context);

  if (result.outcome === "dry-run-complete" && result.cleanFill) {
    context.runs.recordCleanDryRun(context.job.board, context.application.now());
    console.log(`Recorded a clean dry run for the ${context.job.board} board.`);
  } else if (result.outcome === "filled-for-review") {
    await waitForUserSubmit(context, driver, plan, startedAt);
  }
}

/**
 * Runs `scout apply <jobId>`. See the file comment for the order.
 * Failure: a paused Scout, an unknown or wrongly placed job, a reached daily limit or a missing
 * `pdflatex` throw a `ScoutError` before any page is opened.
 */
export async function runApplyCommand(
  application: Application,
  environment: ApplyEnvironment,
  jobId: string,
  options: ApplyCommandOptions,
): Promise<void> {
  application.assertNotPaused();
  const job = loadApplicableJob(application, jobId);
  const settings = application.settingsStore.load();
  const profile = application.profileStore.load();
  const runs = createBoardRunStore(join(application.directory, "board-runs.json"));

  const conditions: LevelConditions = {
    settings,
    level: settings.boardLevels[job.board] ?? "prepare",
    boardSelfTestFailed: runs.hasFailedSelfTest(job.board),
  };
  const level = effectiveLevel(conditions);
  const boardHasCleanRun = runs.hasCleanRun(job.board);
  const dryRun = options.dryRun === true || (settings.dryRunFirst && !boardHasCleanRun);
  const submitPossible = mayAutoSubmit({
    dryRun,
    level,
    applyMode: settings.applyMode,
    jobStatus: job.status,
  });
  if (
    submitPossible &&
    countAppliedToday(application.actionLog, application.now()) >= settings.dailyApplicationLimit
  ) {
    throw new ScoutError(
      "limit-reached",
      `Today's limit of ${settings.dailyApplicationLimit} applications is reached, so Scout will not submit another one until tomorrow.`,
    );
  }

  console.log(`Applying to ${job.company} - ${job.title} [${job.id}] on ${job.board}.`);
  console.log(
    `Level: ${LEVEL_NAMES[level]}${dryRun ? " (this run is a dry run: nothing will be submitted)" : ""}.`,
  );
  const heldBack = explainHeldBack(conditions, job.status, dryRun);
  if (heldBack !== "") console.log(heldBack);

  const context: ApplyContext = {
    application,
    environment,
    job,
    settings,
    profile,
    runs,
    level,
    explicitDryRun: options.dryRun === true,
    dryRun,
    boardHasCleanRun,
    submitPossible,
    url: parseApplicationUrl(options.url, job),
    resumeFile: await findOrBuildResume(application, environment, job, profile),
    evidenceDirectory: evidenceDirectoryFor(application, job),
    profileDirectory: resolve(options.profileDir ?? join(application.directory, "browser-profile")),
    waitSeconds: parseWaitSeconds(options.wait),
  };
  console.log(`Resume: ${context.resumeFile}`);

  if (level === "prepare") {
    await stageOnly(context);
    return;
  }
  const driver = await environment.openBrowser({
    profileDirectory: context.profileDirectory,
    headless: false,
  });
  try {
    await applyWithDriver(context, driver);
  } finally {
    await closeQuietly(driver);
  }
}
