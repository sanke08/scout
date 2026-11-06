/**
 * `scout inbox [--since YYYY-MM-DD] [--folder NAME]`: reads the mailbox (read-only), updates the
 * status of matched applications and lists what it could not match.
 *
 * Why it exists: scenario M. Replies change what the user should do next (an interview invite,
 * a rejection), and typing them in by hand is how a tracker goes stale. The command only reads:
 * Scout never sends, deletes, moves or marks mail as read. A status changes only when one clear
 * application matches and the move is legal; an illegal move is reported, not forced.
 *
 * Alert emails from job platforms (scenario N) are not tracked. They are read as text, printed
 * as leads, and each lead is resolved to the company's own board when the watched boards say so.
 * No job is created from a lead.
 */
import type { Command } from "commander";
import { ScoutError } from "../../shared/index.js";
import {
  createMailboxReader,
  detectAlertPlatform,
  parseAlertEmail,
  resolveToOfficialBoard,
  trackMessages,
  type ParsedMessage,
  type SkippedMessage,
  type TrackedMessage,
} from "../../tracking/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { createBoardLookup } from "./mail-board-lookup.js";
import { readMailCredentials } from "./mail-credentials.js";
import { withApplication } from "./with-application.js";

/** The mail folder read when `--folder` is not given. */
export const DEFAULT_MAIL_FOLDER = "INBOX";

/** How many days back the command reads when `--since` is not given. */
export const DEFAULT_DAYS_BACK = 14;

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The longest piece of untrusted mail text printed on one line. */
const MAXIMUM_PRINTED_CHARACTERS = 70;

/**
 * Makes text from an email safe to print on one line: control characters and line breaks become
 * spaces and long text is cut. Example: `"Hi\nthere"` gives `"Hi there"`.
 */
export function oneLine(text: string, limit = MAXIMUM_PRINTED_CHARACTERS): string {
  // Control characters are exactly what must not reach the terminal from outside text.
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** Reads `--since`, a date like 2026-11-01, or returns `DEFAULT_DAYS_BACK` days before `now`. */
function parseSince(text: string | undefined, now: Date): Date {
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

/** Pads text to a column width. */
function column(text: string, width: number): string {
  return text.padEnd(width);
}

/** Prints the table of messages that matched one application, and what changed for each. */
function printMatched(
  application: Application,
  matched: TrackedMessage[],
  subjects: Map<string, string>,
): void {
  console.log("Matched to your applications:");
  for (const entry of matched) {
    if (entry.match.kind !== "matched") continue;
    const job = application.jobStore.get(entry.match.jobId);
    const jobName = job === undefined ? entry.match.jobId : `${job.company} - ${job.title}`;
    const outcome = entry.outcome;
    let change = "no change (a person must read it)";
    if (outcome !== undefined) {
      change = outcome.changed
        ? `CHANGED: ${outcome.from} -> ${outcome.to}`
        : outcome.reason === "illegal-transition"
          ? `NOT CHANGED, illegal move: ${oneLine(outcome.note, 200)}`
          : `no change: ${outcome.note}`;
    }
    console.log(
      `  ${column(entry.classification.kind, 22)} ${column(oneLine(jobName, 40), 40)} ${change}`,
    );
    console.log(`    subject: ${oneLine(subjects.get(entry.messageId) ?? "")}`);
  }
}

/** Prints the messages that matched no single application, with how many candidates there were. */
function printUnmatched(unmatched: TrackedMessage[], messages: Map<string, ParsedMessage>): void {
  console.log("Not matched to any single application (nothing was changed for these):");
  for (const entry of unmatched) {
    const message = messages.get(entry.messageId);
    const candidates = entry.match.kind === "unmatched" ? entry.match.candidates.length : 0;
    console.log(
      `  ${column(entry.classification.kind, 22)} from ${oneLine(message?.fromAddress ?? "")}: ${oneLine(message?.subject ?? "")} (${candidates} possible application(s))`,
    );
  }
}

/** Prints the leads from alert emails with the board each resolves to, when it can be known offline. */
async function printLeads(application: Application, alerts: ParsedMessage[]): Promise<number> {
  const lookup = createBoardLookup(application.boardStore);
  let count = 0;
  console.log("Leads from job-alert emails (printed only; no job was created):");
  for (const alert of alerts) {
    for (const lead of parseAlertEmail(alert)) {
      count += 1;
      const resolution = await resolveToOfficialBoard(lead, lookup);
      const where =
        resolution.status === "resolved"
          ? `official board ${resolution.board.kind}:${resolution.board.token}`
          : `platform only (${oneLine(resolution.reason, 100)})`;
      console.log(
        `  [${lead.platform}] ${oneLine(lead.title)} at ${oneLine(lead.company)}, ${oneLine(lead.location)} - ${where}`,
      );
      console.log(`    ${oneLine(lead.url, 150)}`);
    }
  }
  if (count === 0) console.log("  none");
  return count;
}

/** Prints the messages the reader could not use. */
function printSkipped(skipped: SkippedMessage[]): void {
  console.log("Skipped (could not be read):");
  for (const entry of skipped)
    console.log(`  message ${oneLine(entry.messageId)}: ${oneLine(entry.reason, 150)}`);
}

/** Runs the command. */
async function readInbox(
  application: Application,
  options: { since?: string; folder?: string },
): Promise<void> {
  // Reading mail also moves job statuses (an interview invite becomes `interviewing`), so the kill
  // switch applies here too.
  application.assertNotPaused();
  const credentials = readMailCredentials(application.environment);
  const since = parseSince(options.since, application.now());
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
  const byId = new Map(others.map((message) => [message.id, message] as const));
  const subjects = new Map(others.map((message) => [message.id, message.subject] as const));
  const matched = tracked.filter((entry) => entry.match.kind === "matched");
  const unmatched = tracked.filter((entry) => entry.match.kind !== "matched");

  console.log(
    `Read ${messages.length} message(s) from ${folder} since ${since.toISOString().slice(0, 10)}. Read-only: nothing was sent, deleted, moved or marked as read.`,
  );
  if (matched.length > 0) printMatched(application, matched, subjects);
  if (unmatched.length > 0) printUnmatched(unmatched, byId);
  const leadCount = alerts.length > 0 ? await printLeads(application, alerts) : 0;
  if (skipped.length > 0) printSkipped(skipped);
  const changed = tracked.filter((entry) => entry.outcome?.changed === true).length;
  console.log(
    `Summary: ${changed} status change(s), ${matched.length} matched, ${unmatched.length} unmatched, ${leadCount} lead(s), ${skipped.length} skipped.`,
  );
}

/** Registers `inbox` on the program. */
export function registerInbox(program: Command, overrides: ApplicationOptions): void {
  program
    .command("inbox")
    .description(
      "Read your mailbox (read-only), update application statuses and list job-alert leads.",
    )
    .option(
      "--since <date>",
      `read mail from this date, YYYY-MM-DD (default: ${DEFAULT_DAYS_BACK} days back)`,
    )
    .option("--folder <name>", `the mail folder to read (default: ${DEFAULT_MAIL_FOLDER})`)
    .action((options: { since?: string; folder?: string }) =>
      withApplication(overrides, (application) => readInbox(application, options)),
    );
}
