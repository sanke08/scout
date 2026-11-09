/**
 * The shapes of the application ledger: the record of every application, who the recruiter is,
 * and everything that happened since (calls, emails, notes, status changes).
 *
 * Why it exists: when a recruiter calls, the user must find the application in seconds and record
 * the outcome. These types are the contract between the ledger, the command line and the web page.
 */
import { z } from "zod";
import { JOB_STATUSES, type JobStatus } from "../shared/index.js";

/** Kinds of history entry. `status` and `applied` are written by Scout; the rest by the user. */
export const EVENT_KINDS = [
  "applied",
  "status",
  "call",
  "email",
  "message",
  "interview",
  "follow-up",
  "note",
] as const;

/** One kind of history entry, for example `"call"`. */
export type EventKind = (typeof EVENT_KINDS)[number];

/** The schema that checks one history entry kind. */
export const eventKindSchema = z.enum(EVENT_KINDS);

/** A short text that is trimmed and may not be longer than `maximum` characters. */
function text(maximum: number): z.ZodString {
  return z.string().trim().max(maximum);
}

/** A calendar date such as `2026-11-12`. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-12.");

/**
 * What the user knows about one application beyond the job itself. Every field is optional; an empty
 * string clears a field. Example: `{ recruiterName: "Sam Okafor", recruiterPhone: "+1 555 0100" }`.
 */
export const applicationDetailsSchema = z.object({
  /** The company's own id for the job, for example a requisition number or Greenhouse job id. */
  externalJobId: text(120).optional(),
  recruiterName: text(120).optional(),
  recruiterFirm: text(120).optional(),
  recruiterEmail: text(200).optional(),
  recruiterPhone: text(60).optional(),
  recruiterLinkedin: text(300).optional(),
  /** How it was sent: `scout`, `manual`, `referral`, or any words the user likes. */
  appliedVia: text(80).optional(),
  /** What to do next, in the user's words, for example "Call back after 4pm". */
  nextStep: text(300).optional(),
  /** The day the next step is due. An empty string clears it. */
  nextStepDate: z.union([dateOnlySchema, z.literal("")]).optional(),
});

/** The details of one application. Missing fields were never set. */
export type ApplicationDetails = z.infer<typeof applicationDetailsSchema>;

/** One line of an application's history. */
export interface ApplicationEvent {
  id: number;
  jobId: string;
  /** ISO time the thing happened (the user may back-date a call). */
  at: string;
  kind: EventKind;
  /** One line, for example "Call from Sam: phone screen on Friday". */
  summary: string;
  /** Longer text, optional. */
  detail?: string;
  /** Who it was with, optional. */
  contact?: string;
}

/** What the user supplies to add a history entry. */
export const newEventSchema = z.object({
  kind: eventKindSchema,
  summary: text(300).min(1, "Write a short summary of what happened."),
  detail: text(4000).optional(),
  contact: text(120).optional(),
  /** ISO time or a date; defaults to now. */
  at: z.string().optional(),
});

/** A history entry before it is saved. */
export type NewEvent = z.infer<typeof newEventSchema>;

/** What the user supplies to record an application made outside Scout. */
export const manualApplicationSchema = z.object({
  company: text(120).min(1, "Name the company."),
  title: text(160).min(1, "Name the role."),
  /** The posting address. Recommended: it is how the job is recognised again. */
  link: text(2000).optional(),
  location: text(120).optional(),
  /** Date applied, `2026-11-12`; defaults to today. */
  appliedOn: dateOnlySchema.optional(),
  details: applicationDetailsSchema.optional(),
});

/** An application made outside Scout, before it is recorded. */
export type ManualApplication = z.infer<typeof manualApplicationSchema>;

/** One application as shown in lists: the job, the user's details and the latest activity. */
export interface LedgerEntry {
  /** Scout's own id for the job; use it in commands. */
  id: string;
  company: string;
  title: string;
  location: string;
  /** The posting address. */
  link: string;
  board: string;
  status: JobStatus;
  statusReason: string | undefined;
  /** The company's own job id: the saved one, else worked out from the link, else empty. */
  jobNumber: string;
  details: ApplicationDetails;
  /** ISO time the application was sent or recorded; empty when unknown. */
  appliedAt: string;
  /** ISO time of the newest history entry or status change. */
  lastActivityAt: string;
  /** True when the next-step date is today or earlier and the application is still open. */
  followUpDue: boolean;
}

/** One application with its whole history, oldest first. */
export interface LedgerDetail extends LedgerEntry {
  events: ApplicationEvent[];
  /** The statuses the user may move this application to right now. */
  allowedStatuses: JobStatus[];
}

/** Filters for listing. */
export interface LedgerFilter {
  /** Only these statuses. */
  statuses?: readonly JobStatus[];
  /** Words to look for in company, role, recruiter, job id, link and notes. */
  search?: string;
  /** Only applications whose next-step date has come. */
  dueOnly?: boolean;
}

/** Statuses that mean the application is over: nothing is waiting on anyone. */
export const FINISHED_STATUSES: readonly JobStatus[] = ["rejected", "withdrawn", "closed"];

/** Statuses a job has once it was sent or may have been sent. */
export const APPLICATION_STATUSES: readonly JobStatus[] = JOB_STATUSES.filter((status) =>
  [
    "submitting",
    "applied",
    "unverified",
    "contacted",
    "interviewing",
    "offer",
    "rejected",
    "withdrawn",
  ].includes(status),
);
