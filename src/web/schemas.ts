/**
 * The shape of every input the API accepts, checked with zod before anything is used. The profile
 * and settings shapes are not redefined here: they come from `src/shared` (one source of truth).
 */
import { z } from "zod";
import { EVENT_KINDS, newEventSchema } from "../ledger/index.js";
import { JOB_STATUSES } from "../shared/index.js";

/** The tags a user can give when skipping a job. They feed back into the filters later. */
export const SKIP_TAGS = ["Wrong location", "Too junior", "Company", "Not interested"] as const;

/** Body of `POST /api/jobs/:id/skip`. Example: `{ "tag": "Too junior" }`. */
export const skipBodySchema = z.object({ tag: z.enum(SKIP_TAGS) }).strict();

/** Body of `approve` and `undo`: nothing, or an empty object. Anything else is refused. */
export const emptyBodySchema = z.object({}).strict().optional();

/**
 * Body of `POST /api/resume`.
 * Example: `{ "keywords": ["Node.js", "Kafka"], "company": "ExampleCorp" }`.
 */
export const resumeBodySchema = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(100)).max(100),
    company: z.string().trim().max(100).optional(),
  })
  .strict();

/** A job id in a path: the letters, digits, dashes and underscores a stable id is made of. */
export const jobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "The job id is not valid.");

/**
 * Body of `POST /api/applications/:id/status`: the status the user reports, with an optional note
 * and date. Example: `{ "status": "rejected", "note": "Email from Alex Rivera", "at": "2026-11-09" }`.
 */
export const statusBodySchema = z
  .object({
    status: z.enum(JOB_STATUSES),
    note: z.string().trim().max(300).optional(),
    at: z.string().trim().max(40).optional(),
  })
  .strict();

/** The history kinds the page may add: Scout alone writes `status` and `applied`. */
const PAGE_EVENT_KINDS: readonly string[] = EVENT_KINDS.filter(
  (kind) => kind !== "status" && kind !== "applied",
);

/** Body of `POST /api/applications/:id/events`: a call, email, message, interview, follow-up or note. */
export const pageEventBodySchema = newEventSchema.refine(
  (event) => PAGE_EVENT_KINDS.includes(event.kind),
  { message: `kind: Use one of ${PAGE_EVENT_KINDS.join(", ")}.`, path: ["kind"] },
);
