/**
 * One inbox pass: read the mailbox (read-only), update the status of matched applications and set
 * apart the job-alert emails.
 *
 * Why it exists: `scout inbox` prints what happened and the web page's "Read inbox now" button
 * reports it in one sentence; both need the same reading, matching and kill-switch rule. The pass
 * only reads: Scout never sends, deletes, moves or marks mail as read. A status changes only when
 * one clear application matches and the move is legal.
 *
 * Example: `const report = await runInboxPass(application, {})`, then `summariseInboxPass(report)`
 * gives "Read 12 messages from INBOX since 2026-10-26: 1 status change, 3 matched, ...".
 */
import { ScoutError } from "../shared/index.js";
import {
  createMailboxReader,
  detectAlertPlatform,
  parseAlertEmail,
  trackMessages,
  type ParsedMessage,
  type SkippedMessage,
  type TrackedMessage,
} from "../tracking/index.js";
import type { Application } from "./application.js";
import { readMailCredentials } from "./commands/mail-credentials.js";

/** The mail folder read when none is given. */
export const DEFAULT_MAIL_FOLDER = "INBOX";

/** How many days back the pass reads when no start date is given. */
export const DEFAULT_DAYS_BACK = 14;

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What one pass found. */
export interface InboxReport {
  folder: string;
  since: Date;
  /** Every message the reader could use, alert emails included. */
  messages: ParsedMessage[];
  /** Messages the reader could not use, and why. */
  skipped: SkippedMessage[];
  /** The job-alert emails: read as leads, never tracked. */
  alerts: ParsedMessage[];
  /** The other messages, each with what the tracker matched and changed. */
  tracked: TrackedMessage[];
  /** The other messages by id, for printing. */
  others: ParsedMessage[];
}

/**
 * Reads a date like 2026-11-01, or returns `DEFAULT_DAYS_BACK` days before `now` when none is given.
 * Failure: text that is not a date gives `ScoutError("invalid-input")` naming the right format.
 */
export function parseInboxSince(text: string | undefined, now: Date): Date {
  if (text === undefined) return new Date(now.getTime() - DEFAULT_DAYS_BACK * DAY_MS);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime())) {
    throw new ScoutError(
      "invalid-input",
      `"${text}" is not a date. Write --since as YYYY-MM-DD, for example --since 2026-11-01.`,
    );
  }
  return date;
}

/**
 * Refuses to start when the kill switch is on or the three mail variables are not set. Reading mail
 * also moves job statuses (an interview invite becomes `interviewing`), so the kill switch applies.
 * Failure: `ScoutError("paused")`, or `ScoutError("invalid-input")` naming the variables to set.
 */
export function assertInboxCanRun(application: Application): void {
  application.assertNotPaused();
  readMailCredentials(application.environment);
}

/** Runs one pass. Failure: the refusals of `assertInboxCanRun`, a bad `since`, or a mailbox that cannot be read. */
export async function runInboxPass(
  application: Application,
  options: { since?: string; folder?: string },
): Promise<InboxReport> {
  application.assertNotPaused();
  const credentials = readMailCredentials(application.environment);
  const since = parseInboxSince(options.since, application.now());
  const folder = options.folder ?? DEFAULT_MAIL_FOLDER;
  const reader = createMailboxReader({ connect: application.mailboxConnector(credentials) });
  const { messages, skipped } = await reader.readSince(folder, since);

  const alerts = messages.filter((message) => detectAlertPlatform(message) !== undefined);
  const others = messages.filter((message) => detectAlertPlatform(message) === undefined);
  const tracked = await trackMessages({
    messages: others,
    jobStore: application.jobStore,
    actionLog: application.actionLog,
  });
  return { folder, since, messages, skipped, alerts, tracked, others };
}

/** How many tracked messages changed a job's status. */
export function countStatusChanges(report: InboxReport): number {
  return report.tracked.filter((entry) => entry.outcome?.changed === true).length;
}

/**
 * One plain sentence about a pass, with counts only (no sender, subject or address).
 * Example: "Read 12 messages from INBOX since 2026-10-26. 1 status change, 3 matched, 2 not matched, 4 leads, 0 skipped."
 */
export function summariseInboxPass(report: InboxReport): string {
  const matched = report.tracked.filter((entry) => entry.match.kind === "matched").length;
  const leads = report.alerts.reduce((total, alert) => total + parseAlertEmail(alert).length, 0);
  const plural = (count: number, word: string): string =>
    `${count} ${word}${count === 1 ? "" : "s"}`;
  return (
    `Read ${plural(report.messages.length, "message")} from ${report.folder} since ${report.since.toISOString().slice(0, 10)}. ` +
    `${plural(countStatusChanges(report), "status change")}, ${matched} matched, ` +
    `${report.tracked.length - matched} not matched, ${plural(leads, "lead")}, ${report.skipped.length} skipped. ` +
    "Read-only: nothing was sent, deleted, moved or marked as read."
  );
}
