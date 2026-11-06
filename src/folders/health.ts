/**
 * The health report: a plain answer to "is Scout running, and does anything need me?".
 *
 * What it shows (IDEA 5.16): the last successful action per actor, queue sizes by job status,
 * model calls used today against the daily budget, whether automation is paused, the jobs
 * waiting for the user (`needs-you`), the number of boards being watched, and whether the
 * heartbeat is stale (Scout has not acted for a day).
 *
 * "Successful" means a log entry whose action name does not contain "fail" or "error".
 * The heartbeat is the time of the newest log entry of any kind; with no entries at all the
 * heartbeat is treated as stale, because nothing has ever run.
 *
 * Example:
 *   const report = buildHealthReport({ jobStore, settings, actionLog, boardsFile, now: () => new Date(), modelCallsToday: () => counter.count });
 *   console.log(renderHealthText(report));
 * Failure: a boards file that is missing or damaged does not throw; the report says so in
 * `boardsProblem`. A heartbeat window that is not positive throws `ScoutError("invalid-input")`.
 */
import { existsSync, readFileSync } from "node:fs";
import { JOB_STATUSES, ScoutError } from "../shared/index.js";
import type { ActionLog, JobStatus, JobStore, Settings } from "../shared/index.js";

/** How many log entries are read to find the last success per actor. */
const LOG_ENTRIES_READ = 1000;

/** Hours without any action after which the heartbeat counts as stale. */
export const DEFAULT_HEARTBEAT_HOURS = 24;

/** What `buildHealthReport` needs. */
export interface HealthInputs {
  jobStore: JobStore;
  /** The loaded settings (for the pause flag and the model budget). */
  settings: Settings;
  actionLog: ActionLog;
  /** Path of a JSON file listing the watched boards as `[{ "kind": "...", "token": "..." }]`. */
  boardsFile?: string;
  now: () => Date;
  /** Injected counter: how many model calls were made today. */
  modelCallsToday: () => number;
  /** Hours of silence before the heartbeat is stale. Default 24. */
  heartbeatHours?: number;
}

/** One job that is waiting for the user. */
export interface WaitingJob {
  id: string;
  company: string;
  title: string;
  /** Why the job needs the user, from the status reason. */
  reason: string;
}

/** The whole report. */
export interface HealthReport {
  generatedAt: string;
  /** ISO time of the last successful action by each actor, such as `{ discovery: "2026-11-07T08:00:00.000Z" }`. */
  lastSuccessByActor: Record<string, string>;
  /** ISO time of the newest log entry of any kind, or undefined if the log is empty. */
  lastRunAt: string | undefined;
  heartbeatStale: boolean;
  /** Number of jobs in each status; every status is present, with 0 when empty. */
  queueSizes: Record<JobStatus, number>;
  modelCallsToday: number;
  modelCallBudget: number;
  automationPaused: boolean;
  needsYou: WaitingJob[];
  /** Number of boards in the boards file, or undefined when no file was given or it is unreadable. */
  watchedBoards: number | undefined;
  /** A sentence about the boards file when it is missing or damaged. */
  boardsProblem: string | undefined;
}

/**
 * True when Scout has not acted for `hours` hours before `now`.
 * `lastRunAt` that is missing or not a valid date counts as stale.
 * Example: last run 25 hours ago with `hours` 24 gives `true`; 23 hours ago gives `false`.
 */
export function isHeartbeatStale(
  lastRunAt: string | Date | undefined,
  now: Date,
  hours: number = DEFAULT_HEARTBEAT_HOURS,
): boolean {
  if (!(hours > 0)) {
    throw new ScoutError(
      "invalid-input",
      `The heartbeat window must be more than 0 hours, but it was ${hours}.`,
    );
  }
  if (lastRunAt === undefined) {
    return true;
  }
  const lastTime = new Date(lastRunAt).getTime();
  if (Number.isNaN(lastTime)) {
    return true;
  }
  return now.getTime() - lastTime > hours * 3_600_000;
}

/** Counts the boards in the boards file, or explains why it cannot. */
function readBoards(boardsFile: string | undefined): { count?: number; problem?: string } {
  if (boardsFile === undefined) {
    return {};
  }
  if (!existsSync(boardsFile)) {
    return {
      problem: `The boards file ${boardsFile} does not exist, so no boards are being watched.`,
    };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(boardsFile, "utf8"));
    if (!Array.isArray(parsed)) {
      return { problem: `The boards file ${boardsFile} must hold a list of boards.` };
    }
    return { count: parsed.length };
  } catch {
    return {
      problem: `The boards file ${boardsFile} is not valid JSON, so the board count is unknown.`,
    };
  }
}

/** Builds the report from the stores, the settings and the injected clock and counter. */
export function buildHealthReport(inputs: HealthInputs): HealthReport {
  const now = inputs.now();
  const entries = inputs.actionLog.recent(LOG_ENTRIES_READ);
  const lastSuccessByActor: Record<string, string> = {};
  for (const entry of entries) {
    const failed = /fail|error/i.test(entry.action);
    const known = lastSuccessByActor[entry.actor];
    if (!failed && (known === undefined || entry.at > known)) {
      lastSuccessByActor[entry.actor] = entry.at;
    }
  }
  const lastRunAt = entries.reduce<string | undefined>(
    (newest, entry) => (newest === undefined || entry.at > newest ? entry.at : newest),
    undefined,
  );
  const queueSizes = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<
    JobStatus,
    number
  >;
  const jobs = inputs.jobStore.list();
  for (const job of jobs) {
    queueSizes[job.status] += 1;
  }
  const boards = readBoards(inputs.boardsFile);
  return {
    generatedAt: now.toISOString(),
    lastSuccessByActor,
    lastRunAt,
    heartbeatStale: isHeartbeatStale(lastRunAt, now, inputs.heartbeatHours),
    queueSizes,
    modelCallsToday: inputs.modelCallsToday(),
    modelCallBudget: inputs.settings.dailyModelCallBudget,
    automationPaused: inputs.settings.automationPaused,
    needsYou: jobs
      .filter((job) => job.status === "needs-you")
      .map((job) => ({
        id: job.id,
        company: job.company,
        title: job.title,
        reason: job.statusReason ?? "unknown",
      })),
    watchedBoards: boards.count,
    boardsProblem: boards.problem,
  };
}

/** Renders the report as short plain text for the terminal or the status area. */
export function renderHealthText(report: HealthReport): string {
  const lines = [`Scout health at ${report.generatedAt}`, ""];
  lines.push(
    report.automationPaused
      ? "Automation: PAUSED (the kill switch is on; finding and scoring continue)."
      : "Automation: running.",
  );
  lines.push(
    report.heartbeatStale
      ? `Heartbeat: STALE. Last activity: ${report.lastRunAt ?? "never"}.`
      : `Heartbeat: fine. Last activity: ${report.lastRunAt}.`,
  );
  lines.push(`Model calls today: ${report.modelCallsToday} of ${report.modelCallBudget}.`);
  if (report.watchedBoards !== undefined) {
    lines.push(`Boards watched: ${report.watchedBoards}.`);
  }
  if (report.boardsProblem !== undefined) {
    lines.push(`Boards: ${report.boardsProblem}`);
  }
  lines.push("", "Last success by part:");
  const actors = Object.entries(report.lastSuccessByActor).sort(([first], [second]) =>
    first.localeCompare(second),
  );
  lines.push(
    ...(actors.length === 0 ? ["  none yet"] : actors.map(([actor, at]) => `  ${actor}: ${at}`)),
  );
  lines.push("", "Jobs by status:");
  const filled = Object.entries(report.queueSizes).filter(([, count]) => count > 0);
  lines.push(
    ...(filled.length === 0
      ? ["  no jobs"]
      : filled.map(([status, count]) => `  ${status}: ${count}`)),
  );
  lines.push("", "Waiting for you:");
  lines.push(
    ...(report.needsYou.length === 0
      ? ["  nothing"]
      : report.needsYou.map((job) => `  ${job.company}, ${job.title} (${job.id}): ${job.reason}`)),
  );
  return `${lines.join("\n")}\n`;
}
