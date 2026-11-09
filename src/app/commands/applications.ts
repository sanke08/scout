/**
 * `scout applications`: the record of every application, for the moments a recruiter calls or an
 * answer arrives.
 *
 * Why it exists: the user must be able to find an application in seconds, see who the recruiter is
 * and what happened last, and record a call, a rejection or an offer without opening a web page.
 * Every change also rewrites `APPLICATIONS.md` in the data folder.
 *
 * Example: `scout applications find acme` lists matches; `scout applications status 1a2b3c rejected
 * "Email from Sam"` records the rejection; `scout applications log 1a2b3c call "Phone screen
 * Friday" --who Sam` adds a call to the history.
 */
import type { Command } from "commander";
import {
  EVENT_KINDS,
  eventKindSchema,
  type ApplicationDetails,
  type Ledger,
  type LedgerDetail,
  type LedgerEntry,
} from "../../ledger/index.js";
import { ScoutError, isJobStatus, type JobStatus } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** Shortens text to `width` characters, ending with `…` when it was cut. */
function fit(text: string, width: number): string {
  return text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 1)}…`;
}

/** The date part of an ISO time, or `----------` when there is none. */
function day(iso: string): string {
  return iso === "" ? "----------" : iso.slice(0, 10);
}

/** One line of the list: enough to recognise the application and see what is next. */
export function describeEntry(entry: LedgerEntry): string {
  const recruiter = entry.details.recruiterName ?? "";
  const next = entry.details.nextStepDate === undefined ? "" : `next ${entry.details.nextStepDate}`;
  const flag = entry.followUpDue ? " !" : "";
  return `${fit(entry.id, 16)}  ${fit(entry.status, 12)}  ${day(entry.appliedAt)}  ${fit(`${entry.company}, ${entry.title}`, 44)}  ${fit(recruiter, 18)}  ${next}${flag}`.trimEnd();
}

/** Prints a list of applications, or a line saying there are none. */
function printList(entries: LedgerEntry[]): void {
  if (entries.length === 0) {
    console.log("No applications match.");
    return;
  }
  console.log(
    `${fit("ID", 16)}  ${fit("STATUS", 12)}  ${fit("APPLIED", 10)}  ${fit("COMPANY, ROLE", 44)}  ${fit("RECRUITER", 18)}  NEXT`,
  );
  for (const entry of entries) console.log(describeEntry(entry));
  console.log(
    `${entries.length} application${entries.length === 1 ? "" : "s"}. "!" means a next step is due.`,
  );
}

/** Prints everything about one application. */
function printDetail(detail: LedgerDetail): void {
  const lines: [string, string | undefined][] = [
    ["Company", detail.company],
    ["Role", detail.title],
    ["Status", detail.status],
    ["Scout id", detail.id],
    ["Job ID", detail.jobNumber],
    ["Link", detail.link],
    ["Applied", detail.appliedAt === "" ? undefined : detail.appliedAt.slice(0, 10)],
    ["Applied via", detail.details.appliedVia],
    ["Recruiter", detail.details.recruiterName],
    ["Firm", detail.details.recruiterFirm],
    ["Email", detail.details.recruiterEmail],
    ["Phone", detail.details.recruiterPhone],
    ["LinkedIn", detail.details.recruiterLinkedin],
    ["Next step", [detail.details.nextStepDate, detail.details.nextStep].filter(Boolean).join(" ")],
  ];
  for (const [label, value] of lines) {
    if (value !== undefined && value !== "") console.log(`${label.padEnd(12)} ${value}`);
  }
  console.log(
    `${"Can become".padEnd(12)} ${detail.allowedStatuses.join(", ") || "nothing (final)"}`,
  );
  console.log("");
  console.log("History:");
  if (detail.events.length === 0) console.log("  Nothing recorded yet.");
  for (const event of detail.events) {
    const who = event.contact === undefined ? "" : ` (${event.contact})`;
    const more = event.detail === undefined || event.detail === "" ? "" : `: ${event.detail}`;
    console.log(
      `  ${event.at.slice(0, 16).replace("T", " ")}  ${event.kind.padEnd(9)}${who} ${event.summary}${more}`,
    );
  }
}

/**
 * Finds the application a command names: the full id or a prefix of at least four characters that
 * matches exactly one. Failure: `not-found`, or `invalid-input` when the prefix is ambiguous.
 */
export function resolveApplicationId(ledger: Ledger, text: string): string {
  const entries = ledger.list();
  const exact = entries.find((entry) => entry.id === text);
  if (exact !== undefined) return exact.id;
  const matches = text.length >= 4 ? entries.filter((entry) => entry.id.startsWith(text)) : [];
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    throw new ScoutError(
      "invalid-input",
      `"${text}" matches ${matches.length} applications. Type more of the id.`,
    );
  }
  throw new ScoutError(
    "not-found",
    `No application has the id "${text}". List them with: scout applications`,
  );
}

/** Reads a status word; failure is `invalid-input` that lists the valid words. */
function readStatus(word: string): JobStatus {
  if (isJobStatus(word)) return word;
  throw new ScoutError(
    "invalid-input",
    `"${word}" is not a status. Use one of: contacted, interviewing, offer, rejected, withdrawn, closed.`,
  );
}

/** The option values of `scout applications contact`, as commander gives them. */
interface ContactOptions {
  name?: string;
  firm?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  jobNumber?: string;
  via?: string;
  next?: string;
  nextOn?: string;
  clearNext?: boolean;
}

/** Turns the contact options into the details to save; `--clear-next` empties the next step. */
function detailsFromOptions(options: ContactOptions): ApplicationDetails {
  const details: ApplicationDetails = {};
  if (options.name !== undefined) details.recruiterName = options.name;
  if (options.firm !== undefined) details.recruiterFirm = options.firm;
  if (options.email !== undefined) details.recruiterEmail = options.email;
  if (options.phone !== undefined) details.recruiterPhone = options.phone;
  if (options.linkedin !== undefined) details.recruiterLinkedin = options.linkedin;
  if (options.jobNumber !== undefined) details.externalJobId = options.jobNumber;
  if (options.via !== undefined) details.appliedVia = options.via;
  if (options.next !== undefined) details.nextStep = options.next;
  if (options.nextOn !== undefined) details.nextStepDate = options.nextOn;
  if (options.clearNext === true) {
    details.nextStep = "";
    details.nextStepDate = "";
  }
  return details;
}

/** Registers `applications` (alias `apps`) and its subcommands. */
export function registerApplications(program: Command, overrides: ApplicationOptions): void {
  const applications = program
    .command("applications")
    .alias("apps")
    .description("Every application, its recruiter and history: find, add, update, export.");

  applications
    .command("list", { isDefault: true })
    .description("List applications, newest activity first.")
    .option("--status <statuses>", "Only these statuses, separated by commas")
    .option("--due", "Only applications whose next step is due")
    .action((options: { status?: string; due?: boolean }) =>
      withApplication(overrides, (application) => {
        const statuses = options.status?.split(",").map((word) => readStatus(word.trim()));
        printList(
          application.ledger.list({
            ...(statuses === undefined ? {} : { statuses }),
            ...(options.due === true ? { dueOnly: true } : {}),
          }),
        );
      }),
    );

  applications
    .command("find")
    .argument("<words...>", "Company, role, recruiter name, phone, job id or anything in the notes")
    .description("Find an application, for example when a recruiter calls.")
    .action((words: string[]) =>
      withApplication(overrides, (application) => {
        printList(application.ledger.list({ search: words.join(" ") }));
      }),
    );

  applications
    .command("due")
    .description("Applications whose next-step date has come.")
    .action(() => withApplication(overrides, (application) => printList(application.ledger.due())));

  applications
    .command("show")
    .argument("<id>", "The application id, or the first characters of it")
    .description("Everything about one application, with its history.")
    .action((id: string) =>
      withApplication(overrides, (application) => {
        const found = application.ledger.get(resolveApplicationId(application.ledger, id));
        if (found === undefined) throw new ScoutError("not-found", `No application "${id}".`);
        printDetail(found);
      }),
    );

  applications
    .command("add")
    .description("Record an application you made outside Scout.")
    .requiredOption("--company <name>", "Company name")
    .requiredOption("--title <role>", "Role you applied for")
    .option("--link <url>", "The posting address (recommended)")
    .option("--on <date>", "Date you applied, like 2026-11-12 (default: today)")
    .option("--location <place>", "Location")
    .option("--job-number <id>", "The company's own job id")
    .option("--recruiter <name>", "Recruiter name")
    .option("--firm <name>", "Recruiter's firm")
    .option("--email <address>", "Recruiter email")
    .option("--phone <number>", "Recruiter phone")
    .option("--via <how>", "How you applied (default: manual)")
    .action(
      (options: {
        company: string;
        title: string;
        link?: string;
        on?: string;
        location?: string;
        jobNumber?: string;
        recruiter?: string;
        firm?: string;
        email?: string;
        phone?: string;
        via?: string;
      }) =>
        withApplication(overrides, (application) => {
          const details = detailsFromOptions({
            ...(options.jobNumber === undefined ? {} : { jobNumber: options.jobNumber }),
            ...(options.recruiter === undefined ? {} : { name: options.recruiter }),
            ...(options.firm === undefined ? {} : { firm: options.firm }),
            ...(options.email === undefined ? {} : { email: options.email }),
            ...(options.phone === undefined ? {} : { phone: options.phone }),
            ...(options.via === undefined ? {} : { via: options.via }),
          });
          const saved = application.ledger.addManual({
            company: options.company,
            title: options.title,
            ...(options.link === undefined ? {} : { link: options.link }),
            ...(options.on === undefined ? {} : { appliedOn: options.on }),
            ...(options.location === undefined ? {} : { location: options.location }),
            details,
          });
          console.log(`Recorded: ${saved.company}, ${saved.title} (id ${saved.id}).`);
          console.log(`Ledger file: ${application.ledger.writeFile() ?? "not written"}`);
        }),
    );

  applications
    .command("status")
    .argument("<id>", "The application id, or the first characters of it")
    .argument("<status>", "contacted, interviewing, offer, rejected, withdrawn or closed")
    .argument("[note...]", "What happened, in your words")
    .option("--on <date>", "When it happened, like 2026-11-12 (default: now)")
    .description("Record a new status you were told about, for example a rejection or an offer.")
    .action((id: string, status: string, note: string[], options: { on?: string }) =>
      withApplication(overrides, (application) => {
        const saved = application.ledger.setStatus(
          resolveApplicationId(application.ledger, id),
          readStatus(status),
          note.join(" "),
          options.on,
        );
        console.log(`${saved.company}, ${saved.title}: now ${saved.status}.`);
      }),
    );

  applications
    .command("log")
    .argument("<id>", "The application id, or the first characters of it")
    .argument(
      "<kind>",
      `One of: ${EVENT_KINDS.filter((kind) => kind !== "status" && kind !== "applied").join(", ")}`,
    )
    .argument("<summary...>", "One line about what happened")
    .option("--who <name>", "Who it was with")
    .option("--detail <text>", "More detail")
    .option("--on <date>", "When it happened, like 2026-11-12 (default: now)")
    .description("Add a call, email, interview or note to an application's history.")
    .action(
      (
        id: string,
        kind: string,
        summary: string[],
        options: { who?: string; detail?: string; on?: string },
      ) =>
        withApplication(overrides, (application) => {
          const checkedKind = eventKindSchema.safeParse(kind);
          if (
            !checkedKind.success ||
            checkedKind.data === "status" ||
            checkedKind.data === "applied"
          ) {
            throw new ScoutError(
              "invalid-input",
              `"${kind}" is not a kind of entry. Use: call, email, message, interview, follow-up or note. To change the status use: scout applications status`,
            );
          }
          const saved = application.ledger.addEvent(resolveApplicationId(application.ledger, id), {
            kind: checkedKind.data,
            summary: summary.join(" "),
            ...(options.who === undefined ? {} : { contact: options.who }),
            ...(options.detail === undefined ? {} : { detail: options.detail }),
            ...(options.on === undefined ? {} : { at: options.on }),
          });
          console.log(`Added to the history: ${saved.kind}, ${saved.summary}`);
        }),
    );

  applications
    .command("contact")
    .argument("<id>", "The application id, or the first characters of it")
    .description(
      "Set the recruiter, the company's job id or the next step. An empty value clears a field.",
    )
    .option("--name <name>", "Recruiter name")
    .option("--firm <name>", "Recruiter's firm")
    .option("--email <address>", "Recruiter email")
    .option("--phone <number>", "Recruiter phone")
    .option("--linkedin <url>", "Recruiter LinkedIn address")
    .option("--job-number <id>", "The company's own job id")
    .option("--via <how>", "How you applied")
    .option("--next <text>", "What to do next, for example 'Call back after 4pm'")
    .option("--next-on <date>", "The day it is due, like 2026-11-14")
    .option("--clear-next", "Remove the next step")
    .action((id: string, options: ContactOptions) =>
      withApplication(overrides, (application) => {
        const saved = application.ledger.saveDetails(
          resolveApplicationId(application.ledger, id),
          detailsFromOptions(options),
        );
        console.log(`Saved for ${saved.company}, ${saved.title}.`);
      }),
    );

  applications
    .command("export")
    .description("Rewrite APPLICATIONS.md in the data folder and print its path.")
    .action(() =>
      withApplication(overrides, (application) => {
        console.log(application.ledger.writeFile() ?? "No ledger file is configured.");
      }),
    );
}
