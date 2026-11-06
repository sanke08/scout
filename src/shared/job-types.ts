/**
 * The shape of a job posting after discovery has normalised it, and of the stored job record.
 *
 * `Posting` is what the discovery module produces. `JobRecord` is a posting plus its status; the
 * store module owns persistence of `JobRecord`.
 */
import { z } from "zod";
import { JOB_STATUSES } from "./job-status.js";

export const boardKindSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "recruitee",
  "feed",
  "other",
]);
export type BoardKind = z.infer<typeof boardKindSchema>;

export const remoteKindSchema = z.enum(["remote", "hybrid", "onsite", "unknown"]);
export type RemoteKind = z.infer<typeof remoteKindSchema>;

export const seniorityKindSchema = z.enum(["intern", "junior", "mid", "senior", "lead", "unknown"]);
export type SeniorityKind = z.infer<typeof seniorityKindSchema>;

/** Where a posting was seen. One job found on five sites has five sources. */
export const postingSourceSchema = z.object({
  /** Human name of the source, e.g. "greenhouse:examplecorp". */
  name: z.string(),
  url: z.string(),
});
export type PostingSource = z.infer<typeof postingSourceSchema>;

export const postingSchema = z.object({
  /** Stable id: a hash of the canonical URL (see discovery module). */
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remote: remoteKindSchema,
  salary: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: z.string().optional(),
      period: z.enum(["year", "month"]).optional(),
    })
    .optional(),
  seniority: seniorityKindSchema,
  /** Skills named by the posting, as written, e.g. "Node.js". */
  skills: z.array(z.string()),
  /** The full posting text, kept word for word. */
  description: z.string(),
  /** ISO timestamp the employer posted it, when known. */
  postedAt: z.string().optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  sources: z.array(postingSourceSchema),
  /** The one true apply address. The official-board version wins over aggregator copies. */
  canonicalUrl: z.string(),
  board: boardKindSchema,
  /** Flags such as "ghost-suspect", "scam-suspect", "repost". */
  flags: z.array(z.string()),
});
export type Posting = z.infer<typeof postingSchema>;

export const jobRecordSchema = postingSchema.extend({
  status: z.enum(JOB_STATUSES),
  /** Why the job has this status, in plain words. */
  statusReason: z.string().optional(),
  updatedAt: z.string(),
});
export type JobRecord = z.infer<typeof jobRecordSchema>;
