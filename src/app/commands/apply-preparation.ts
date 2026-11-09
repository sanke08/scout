/**
 * What `scout apply` gathers before it touches a page: the daily counter, the resume file, the
 * evidence folder, and the plain-words description of the plan.
 *
 * Why it exists: `runApplication` takes all of these as plain arguments (it opens no files of its
 * own), and the command should only parse, call and print. Keeping the gathering here keeps the
 * command short enough to read top to bottom.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { FillPlan } from "../../apply/index.js";
import { createJobFolderManager } from "../../folders/index.js";
import type { ActionLog, BoardLevel, JobRecord, Profile, Settings } from "../../shared/index.js";
import type { Application } from "../application.js";
import type { ApplyEnvironment } from "./apply-environment.js";

/** How many action-log entries are read to count today's applications. Far above any real day. */
export const ACTION_LOG_SCAN_LIMIT = 100_000;

/** The longest value shown in the printed plan; longer text is cut so a long answer does not flood the screen. */
const SHOWN_VALUE_LENGTH = 60;

/** The plain names of the three levels, as Settings shows them. */
export const LEVEL_NAMES: Record<BoardLevel, string> = {
  prepare: "Prepare only",
  fill: "Fill, I submit",
  auto: "Automatic",
};

/** A calendar day as `2026-11-07` in the computer's own time zone, so "today" means the user's today. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Counts the jobs that moved to `applied` or `unverified` today (both mean a submit may have been
 * sent), from the action log (the store writes `submitting -> applied: reason` for every move).
 * Example: two entries `submitting -> applied: ...` stamped today and one stamped yesterday give 2.
 */
export function countAppliedToday(actionLog: ActionLog, now: Date): number {
  const today = dayKey(now);
  return actionLog
    .recent(ACTION_LOG_SCAN_LIMIT)
    .filter(
      (entry) =>
        entry.action === "transition" &&
        /^[a-z-]+ -> (applied|unverified): /.test(entry.detail) &&
        dayKey(new Date(entry.at)) === today,
    ).length;
}

/**
 * Counts the jobs that were moved to `submitting` today, from the action log. Every submit attempt
 * writes exactly one such line before the click, so this counts attempts whose outcome is not yet
 * known as well as finished ones. It is what the atomic daily-limit claim uses.
 * Example: three jobs moved to `submitting` today and one yesterday give 3.
 */
export function countSubmitsToday(actionLog: ActionLog, now: Date): number {
  const today = dayKey(now);
  const jobs = new Set<string>();
  for (const entry of actionLog.recent(ACTION_LOG_SCAN_LIMIT)) {
    if (
      entry.action === "transition" &&
      /^[a-z-]+ -> submitting: /.test(entry.detail) &&
      dayKey(new Date(entry.at)) === today
    ) {
      jobs.add(entry.jobId ?? entry.detail);
    }
  }
  return jobs.size;
}

/** The folder that holds every job folder of this data folder. */
export function jobsFolderOf(application: Pick<Application, "directory">): string {
  return join(application.directory, "jobs");
}

/**
 * Where this job's evidence goes: `<jobs>/<job folder>/evidence` when the folders module already
 * made a folder for the job, otherwise `<data>/evidence/<job id>`. Nothing is created here.
 * Example: a job with folder `2026-11-07_Acme_Backend` gives `.../jobs/2026-11-07_Acme_Backend/evidence`.
 */
export function evidenceDirectoryFor(application: Application, job: JobRecord): string {
  const folders = createJobFolderManager({
    jobsDirectory: jobsFolderOf(application),
    now: () => application.now(),
  });
  const folderName = folders.findJobFolder(job);
  return folderName === undefined
    ? join(application.directory, "evidence", job.id)
    : join(jobsFolderOf(application), folderName, "evidence");
}

/**
 * The tailored resume PDF the job's folder already holds (the `resume_tailored` line of `job.md`
 * names a PDF that exists there), or `undefined` when there is none.
 * Example: a folder whose `job.md` says `resume_tailored: Alex_Rivera_Acme.pdf` and holds that file
 * gives its full path.
 */
export function findSavedResume(application: Application, job: JobRecord): string | undefined {
  const folders = createJobFolderManager({
    jobsDirectory: jobsFolderOf(application),
    now: () => application.now(),
  });
  const folderName = folders.findJobFolder(job);
  if (folderName === undefined) return undefined;
  const saved = folders.readJob(folderName).fields["resume_tailored"];
  if (saved === undefined || !saved.toLowerCase().endsWith(".pdf") || basename(saved) !== saved) {
    return undefined;
  }
  const path = join(jobsFolderOf(application), folderName, saved);
  return existsSync(path) ? path : undefined;
}

/**
 * The PDF to upload. The job folder's tailored resume is used when the folders module saved one.
 * Otherwise a resume is built from the profile and the job's skills and compiled into
 * `<data>/resumes/`.
 * Failure: a missing `pdflatex` throws `ScoutError("unavailable")` whose message says so and what to
 * install; the command stops there and nothing has been opened or changed.
 */
export async function findOrBuildResume(
  application: Application,
  environment: ApplyEnvironment,
  job: JobRecord,
  profile: Profile,
): Promise<string> {
  const saved = findSavedResume(application, job);
  if (saved !== undefined) return saved;
  const build = application.resumeBuilder.build(profile, job.skills, { company: job.company });
  const compiled = await environment.compileResume(
    build.texSource,
    join(application.directory, "resumes"),
    build.fileStem,
  );
  if (compiled.pageCount !== 1) {
    console.log(
      `Warning: the resume has ${compiled.pageCount} pages, not one. Remove a point or a project from your profile.`,
    );
  }
  return compiled.pdfPath;
}

/** Cuts long text for the printed plan. Example: a 200-letter answer shows its first 60 letters and "...". */
function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= SHOWN_VALUE_LENGTH
    ? oneLine
    : `${oneLine.slice(0, SHOWN_VALUE_LENGTH)}...`;
}

/**
 * The plan in plain words: what Scout will fill, what needs the user, what is left blank. A file
 * is shown by its name only. Example line: `  - Email: alex@example.com`.
 */
export function describePlan(plan: FillPlan): string[] {
  const lines = [`Ready to fill (${plan.actions.length}):`];
  for (const action of plan.actions) {
    const shown = action.kind === "upload" ? basename(action.value) : shorten(action.value);
    lines.push(`  - ${action.label}: ${shown}`);
  }
  lines.push(`Needs you (${plan.blockers.length}):`);
  for (const blocker of plan.blockers) lines.push(`  - ${blocker.label}: ${blocker.reason}`);
  if (plan.leftBlank.length > 0) {
    lines.push(`Left blank, optional (${plan.leftBlank.length}):`);
    for (const blank of plan.leftBlank) lines.push(`  - ${blank.label}: ${blank.reason}`);
  }
  return lines;
}

/** What decides how far this run may go: the settings, the board's record and the job. */
export interface LevelConditions {
  settings: Settings;
  level: BoardLevel;
  /** True when the board's latest self-test failed (Scenario P). */
  boardSelfTestFailed: boolean;
}

/**
 * The level that will really apply. A board set to Automatic is held back to Fill, I submit when a
 * self-test failed on it. (The apply module holds it back further for the other conditions.)
 * Example: `{ level: "auto", boardSelfTestFailed: true }` gives `"fill"`.
 */
export function effectiveLevel(conditions: LevelConditions): BoardLevel {
  return conditions.level === "auto" && conditions.boardSelfTestFailed ? "fill" : conditions.level;
}

/**
 * One sentence on why a board set to Automatic is only filling, or an empty string when nothing
 * holds it back. Example: apply mode `approve` gives "Settings say to wait for your approval".
 */
export function explainHeldBack(
  conditions: LevelConditions,
  jobStatus: JobRecord["status"],
  dryRun: boolean,
): string {
  if (conditions.level !== "auto") return "";
  const reasons: string[] = [];
  if (conditions.boardSelfTestFailed) reasons.push("the board's latest self-test failed");
  if (conditions.settings.applyMode !== "auto") {
    reasons.push(`the apply mode in Settings is "${conditions.settings.applyMode}", not "auto"`);
  }
  if (jobStatus !== "approved") reasons.push(`the job is "${jobStatus}", not "approved"`);
  if (dryRun) reasons.push("this run is a dry run, so nothing is submitted");
  return reasons.length === 0 ? "" : `Scout will only fill the form because ${reasons.join("; ")}.`;
}

/**
 * The exact summary the user confirms before Scout presses submit at level Automatic: the job, the
 * page and every value that will be sent, in full. A file is shown by its name only.
 */
export function describeSubmission(plan: FillPlan, job: JobRecord): string[] {
  const lines = [
    `This is exactly what Scout will submit for ${job.company} - ${job.title} [${job.id}]:`,
    `  Page: ${plan.url}`,
  ];
  for (const action of plan.actions) {
    const shown = action.kind === "upload" ? basename(action.value) : action.value;
    lines.push(`  ${action.label}: ${shown}`);
  }
  return lines;
}
