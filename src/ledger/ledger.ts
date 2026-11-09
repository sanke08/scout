/**
 * The application ledger: one place that knows every application, its recruiter, its history and
 * its next step, and that keeps `APPLICATIONS.md` in step.
 *
 * Why it exists: the user must never lose track of an application. Scout's own submits are written
 * here automatically (through `noteTransition`); applications made elsewhere and everything that
 * happens afterwards (calls, emails, rejections) are recorded by the user through this file's
 * functions, from the command line or the Applications page.
 *
 * Rules kept here:
 * - A status the user reports is reached only by legal steps of the state machine, each one written
 *   down; nothing is forced.
 * - History is only ever added to.
 * - A failure to write `APPLICATIONS.md` never undoes or blocks a change: the database is the
 *   source of truth and the file can be rebuilt with `scout applications export`.
 *
 * Example: `ledger.addManual({ company: "Acme", title: "Backend Engineer", link })` records an
 * application sent elsewhere; `ledger.setStatus(id, "interviewing", "Phone screen on Friday")`
 * moves it and writes the history line.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { postingIdFromUrl } from "../discovery/index.js";
import { writeTextAtomic } from "../folders/index.js";
import { ScoutError } from "../shared/index.js";
import type { JobRecord, JobStatus, JobStore, Posting } from "../shared/index.js";
import { jobNumberFromLink } from "./job-number.js";
import type { LedgerStore } from "./ledger-store.js";
import { returnFromNeedsYou } from "./waiting.js";
import { renderLedgerMarkdown } from "./render-markdown.js";
import { reachableStatuses, statusPath } from "./status-path.js";
import {
  APPLICATION_STATUSES,
  FINISHED_STATUSES,
  WAITING_FOR_SUBMIT_MARKER,
  applicationDetailsSchema,
  manualApplicationSchema,
  newEventSchema,
} from "./types.js";
import type {
  ApplicationDetails,
  ApplicationEvent,
  LedgerDetail,
  LedgerEntry,
  LedgerFilter,
  ManualApplication,
  NewEvent,
} from "./types.js";

/** The ledger as the rest of Scout uses it. */
export interface Ledger {
  /** Applications, newest activity first. */
  list(filter?: LedgerFilter): LedgerEntry[];
  /** One application with its history, or `undefined` when it is not in the ledger. */
  get(jobId: string): LedgerDetail | undefined;
  /** Applications whose next-step date has come. */
  due(): LedgerEntry[];
  /**
   * Records an application made outside Scout, or one Scout did not record. `recordedBy` is
   * `"owner"` (the command line and the web page: the default) or `"model"` (autopilot): the model
   * is refused when the job already exists in a status before submitting, because a spoofed email
   * could otherwise mark a job applied that was never sent and block the real application forever.
   */
  addManual(input: ManualApplication, options?: { recordedBy?: "owner" | "model" }): LedgerDetail;
  /** Moves an application to a status the user reports, through legal steps only. */
  setStatus(jobId: string, status: JobStatus, note?: string, at?: string): LedgerDetail;
  /** Adds a call, email, interview or note to the history. */
  addEvent(jobId: string, input: NewEvent): ApplicationEvent;
  /** Changes the recruiter, job number or next-step fields. An empty string clears a field. */
  saveDetails(jobId: string, patch: ApplicationDetails): LedgerDetail;
  /** The full Markdown text of the ledger file. */
  renderMarkdown(): string;
  /** Rewrites the ledger file; returns its path, or `undefined` when no file is configured. */
  writeFile(): string | undefined;
  /** Called after any status change anywhere in Scout, so the history and file stay current. */
  noteTransition(jobId: string, from: JobStatus, to: JobStatus, reason: string): void;
}

/** What `createLedger` needs. */
export interface LedgerOptions {
  /** The job store the rest of Scout uses (with the ledger hook), so every change is recorded. */
  jobStore: JobStore;
  /** The ledger tables. */
  store: LedgerStore;
  now: () => Date;
  /** Where `APPLICATIONS.md` is written. Left out, no file is written. */
  filePath?: string;
  /** Told when the file could not be written (the change itself still stands). */
  onFileError?: (message: string) => void;
}

/** The statuses a manual record walks through, in order, to reach `applied`. */
const RECORD_CHAIN: readonly JobStatus[] = ["shortlisted", "approved", "submitting", "applied"];

/** Statuses before a submit, where the model may not record "applied" by itself. */
const PRE_SUBMIT_STATUSES: readonly JobStatus[] = [
  "found",
  "shortlisted",
  "resume-ready",
  "approved",
  "skipped",
  "needs-you",
];

/** True for a job in `needs-you` whose reason says the filled form is waiting for the owner's submit. */
function isWaitingForSubmit(job: JobRecord): boolean {
  return (
    job.status === "needs-you" &&
    (job.statusReason ?? "").toLowerCase().includes(WAITING_FOR_SUBMIT_MARKER)
  );
}

/** An ISO time from a date (noon UTC) or a full time; an unreadable value is `invalid-input`. */
function toIsoTime(value: string | undefined, now: Date): string {
  if (value === undefined || value === "") return now.toISOString();
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new ScoutError(
      "invalid-input",
      `"${value}" is not a date or time Scout can read. Use 2026-11-12.`,
    );
  }
  return parsed.toISOString();
}

/** A stable id for a posting that has no address, from what the user typed. */
function idFromText(company: string, title: string, day: string): string {
  return createHash("sha256")
    .update(`${company.toLowerCase()}|${title.toLowerCase()}|${day}`)
    .digest("hex")
    .slice(0, 16);
}

/** Creates the ledger. */
export function createLedger(options: LedgerOptions): Ledger {
  const { jobStore, store, now } = options;
  /** Set while the ledger itself moves a job, so the history line carries the right time. */
  let timeOverride: string | undefined;

  /** Builds the list view of one job. */
  function entryOf(
    job: JobRecord,
    details: ApplicationDetails,
    appliedAt: string | undefined,
    lastActivity: string | undefined,
  ): LedgerEntry {
    const today = now().toISOString().slice(0, 10);
    const due =
      details.nextStepDate !== undefined &&
      details.nextStepDate !== "" &&
      details.nextStepDate <= today &&
      !FINISHED_STATUSES.includes(job.status);
    return {
      id: job.id,
      company: job.company,
      title: job.title,
      location: job.location,
      link: job.canonicalUrl,
      board: job.board,
      status: job.status,
      statusReason: job.statusReason,
      jobNumber: details.externalJobId ?? jobNumberFromLink(job.canonicalUrl),
      details,
      appliedAt: appliedAt ?? "",
      lastActivityAt: lastActivity ?? job.updatedAt,
      followUpDue: due,
    };
  }

  /** The ids of every job that belongs in the ledger. */
  function ledgerIds(): string[] {
    const ids = new Set<string>(
      jobStore.list({ status: [...APPLICATION_STATUSES] }).map((job) => job.id),
    );
    for (const job of jobStore.list({ status: ["needs-you"] })) {
      if (isWaitingForSubmit(job)) ids.add(job.id);
    }
    for (const id of store.appliedTimes().keys()) ids.add(id);
    for (const id of store.allDetails().keys()) ids.add(id);
    return [...ids];
  }

  function list(filter: LedgerFilter = {}): LedgerEntry[] {
    const allDetails = store.allDetails();
    const applied = store.appliedTimes();
    const activity = store.lastActivity();
    const words = (filter.search ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const eventHits = words.map((word) => store.searchText(word));
    const entries: LedgerEntry[] = [];
    for (const id of ledgerIds()) {
      const job = jobStore.get(id);
      if (job === undefined) continue;
      if (filter.statuses !== undefined && !filter.statuses.includes(job.status)) continue;
      const entry = entryOf(job, allDetails.get(id) ?? {}, applied.get(id), activity.get(id));
      if (filter.dueOnly === true && !entry.followUpDue) continue;
      if (words.length > 0) {
        const haystack = [
          entry.company,
          entry.title,
          entry.location,
          entry.jobNumber,
          entry.id,
          entry.link,
          entry.status,
          ...Object.values(entry.details),
        ]
          .join(" ")
          .toLowerCase();
        const matchesAll = words.every(
          (word, index) => haystack.includes(word) || eventHits[index]!.has(id),
        );
        if (!matchesAll) continue;
      }
      entries.push(entry);
    }
    return entries.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  function get(jobId: string): LedgerDetail | undefined {
    const job = jobStore.get(jobId);
    if (job === undefined) return undefined;
    const details = store.getDetails(jobId);
    const events = store.events(jobId);
    const waiting = isWaitingForSubmit(job);
    const inLedger =
      APPLICATION_STATUSES.includes(job.status) ||
      waiting ||
      events.some((event) => event.kind === "applied") ||
      Object.keys(details).length > 0;
    if (!inLedger) return undefined;
    const applied = events.find((event) => event.kind === "applied")?.at;
    const last = events.length > 0 ? events[events.length - 1]!.at : undefined;
    return {
      ...entryOf(job, details, applied, last),
      events,
      allowedStatuses: waiting
        ? ["applied", ...reachableStatuses("applied", undefined)]
        : reachableStatuses(job.status, undefined),
    };
  }

  /** The record of one application, or a clear `not-found`. */
  function require(jobId: string): LedgerDetail {
    const found = get(jobId);
    if (found === undefined) {
      throw new ScoutError(
        "not-found",
        `No application with the id ${jobId} is in the ledger. List them with: scout applications`,
      );
    }
    return found;
  }

  function writeFile(): string | undefined {
    if (options.filePath === undefined) return undefined;
    mkdirSync(dirname(options.filePath), { recursive: true });
    writeTextAtomic(options.filePath, renderMarkdown());
    return options.filePath;
  }

  /** Rewrites the file after a change; a failure is reported, never thrown. */
  function refreshFile(): void {
    try {
      writeFile();
    } catch (error) {
      options.onFileError?.(error instanceof Error ? error.message : String(error));
    }
  }

  function renderMarkdown(): string {
    const entries = list();
    const details = entries
      .map((entry) => get(entry.id))
      .filter((detail): detail is LedgerDetail => detail !== undefined);
    return renderLedgerMarkdown(details, now());
  }

  /** Moves a job one status at a time, so each step is checked and written down. */
  function walk(
    jobId: string,
    steps: readonly JobStatus[],
    reason: (step: JobStatus) => string,
  ): void {
    for (const step of steps) jobStore.transition(jobId, step, reason(step));
  }

  /** True when the job is in `needs-you` waiting for the owner's own submit. */
  function waitingJob(jobId: string): boolean {
    const job = jobStore.get(jobId);
    return job !== undefined && isWaitingForSubmit(job);
  }

  /**
   * The owner says they pressed submit on a form Scout filled and handed over. The job is walked
   * back to where it came from, then through `approved` and `submitting` (which marks it as ever
   * submitted, so it can never be applied for again) to `applied`, then on to `status` by legal
   * steps. Each step is written down.
   */
  function recordHandSubmit(
    jobId: string,
    status: JobStatus,
    note: string | undefined,
    at: string | undefined,
  ): LedgerDetail {
    const cleanNote = note?.trim() ?? "";
    const target = statusPath("applied", undefined, status);
    if (target === undefined) {
      throw new ScoutError(
        "illegal-transition",
        `A form waiting for you to press submit can be recorded as applied, or as a later status such as contacted or interviewing. It cannot be recorded as ${status}.`,
      );
    }
    timeOverride = toIsoTime(at, now());
    try {
      returnFromNeedsYou(jobStore, jobId, "Passed through while recording your own submit.");
      if (jobStore.get(jobId)?.status !== "approved") {
        jobStore.transition(jobId, "approved", "Passed through while recording your own submit.");
      }
      jobStore.transition(jobId, "submitting", "Passed through while recording your own submit.");
      jobStore.transition(
        jobId,
        "applied",
        `You reported that you pressed submit yourself${cleanNote === "" ? "." : `: ${cleanNote}`}`,
      );
      walk(jobId, target, (step) =>
        step === status
          ? `You reported ${status}${cleanNote === "" ? "." : `: ${cleanNote}`}`
          : `Passed through on the way to ${status}, as you reported.`,
      );
    } finally {
      timeOverride = undefined;
    }
    refreshFile();
    return require(jobId);
  }

  return {
    list,
    get,
    due: () => list({ dueOnly: true }),

    addManual(input, options = {}) {
      const checked = manualApplicationSchema.parse(input);
      const when = toIsoTime(checked.appliedOn, now());
      const link = checked.link ?? "";
      let id: string;
      try {
        id =
          link === ""
            ? idFromText(checked.company, checked.title, when.slice(0, 10))
            : postingIdFromUrl(link);
      } catch {
        throw new ScoutError(
          "invalid-input",
          `"${link}" is not a web address Scout can read. Include the full address, starting with https://`,
        );
      }
      const existing = jobStore.get(id);
      if (existing !== undefined && APPLICATION_STATUSES.includes(existing.status)) {
        throw new ScoutError(
          "invalid-input",
          `This application is already in the ledger as ${existing.status} (id ${id}). Update it with: scout applications status ${id} <status>`,
        );
      }
      if (
        existing !== undefined &&
        options.recordedBy === "model" &&
        PRE_SUBMIT_STATUSES.includes(existing.status)
      ) {
        throw new ScoutError(
          "invalid-input",
          `Scout already has this job (id ${id}) as ${existing.status} and no submit was recorded, so it will not be marked applied from here. Call flag_for_user so the owner confirms it, then they can record it themselves.`,
        );
      }
      if (existing === undefined) {
        const stamp = now().toISOString();
        const posting: Posting = {
          id,
          company: checked.company,
          title: checked.title,
          location: checked.location ?? "Not stated",
          remote: "unknown",
          seniority: "unknown",
          skills: [],
          description: "",
          firstSeenAt: stamp,
          lastSeenAt: stamp,
          sources: [{ name: "manual", url: link }],
          canonicalUrl: link,
          board: "other",
          flags: ["manual-entry"],
        };
        jobStore.upsertPosting(posting);
      } else if (
        !["found", "shortlisted", "resume-ready", "approved", "skipped"].includes(existing.status)
      ) {
        throw new ScoutError(
          "illegal-transition",
          `The job is ${existing.status}, so it cannot be recorded as applied. Check its status first.`,
        );
      }
      const current = jobStore.get(id)!.status;
      const chain: JobStatus[] =
        current === "skipped"
          ? ["found", ...RECORD_CHAIN]
          : current === "resume-ready"
            ? RECORD_CHAIN.slice(1)
            : RECORD_CHAIN.slice(RECORD_CHAIN.indexOf(current as JobStatus) + 1);
      timeOverride = when;
      try {
        walk(id, chain, (step) =>
          step === "applied"
            ? "You recorded that you applied outside Scout."
            : "Passed through while recording an application you made yourself.",
        );
      } finally {
        timeOverride = undefined;
      }
      store.saveDetails(
        id,
        applicationDetailsSchema.parse({ appliedVia: "manual", ...checked.details }),
        now(),
      );
      refreshFile();
      return require(id);
    },

    setStatus(jobId, status, note, at) {
      const detail = require(jobId);
      if (detail.status === status) {
        throw new ScoutError("invalid-input", `The application is already ${status}.`);
      }
      if (waitingJob(jobId) && status !== "closed" && status !== "skipped") {
        return recordHandSubmit(jobId, status, note, at);
      }
      const path = statusPath(detail.status, undefined, status);
      if (path === undefined) {
        const choices = detail.allowedStatuses.join(", ");
        throw new ScoutError(
          "illegal-transition",
          `An application that is ${detail.status} cannot be moved to ${status}. You can report: ${choices.length > 0 ? choices : "nothing (it is final)"}.`,
        );
      }
      const cleanNote = note?.trim() ?? "";
      timeOverride = toIsoTime(at, now());
      try {
        walk(jobId, path, (step) =>
          step === status
            ? `You reported ${status}${cleanNote === "" ? "." : `: ${cleanNote}`}`
            : `Passed through on the way to ${status}, as you reported.`,
        );
      } finally {
        timeOverride = undefined;
      }
      refreshFile();
      return require(jobId);
    },

    addEvent(jobId, input) {
      require(jobId);
      const checked = newEventSchema.parse(input);
      const saved = store.addEvent(jobId, { ...checked, at: toIsoTime(checked.at, now()) });
      refreshFile();
      return saved;
    },

    saveDetails(jobId, patch) {
      require(jobId);
      store.saveDetails(jobId, applicationDetailsSchema.parse(patch), now());
      refreshFile();
      return require(jobId);
    },

    renderMarkdown,
    writeFile,

    noteTransition(jobId, from, to, reason) {
      if (to === "submitting") return;
      const at = timeOverride ?? now().toISOString();
      if (to === "applied") {
        store.addEvent(jobId, { kind: "applied", summary: "Applied.", detail: reason, at });
      } else if (to === "unverified") {
        store.addEvent(jobId, {
          kind: "applied",
          summary: "Submit attempted; no confirmation was seen, so it is unverified.",
          detail: reason,
          at,
        });
      } else if (APPLICATION_STATUSES.includes(from) || APPLICATION_STATUSES.includes(to)) {
        store.addEvent(jobId, { kind: "status", summary: `${from} -> ${to}`, detail: reason, at });
      } else {
        return;
      }
      refreshFile();
    },
  };
}
