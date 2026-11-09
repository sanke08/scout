/**
 * The shape of every input the API accepts, checked with zod before anything is used. The profile
 * and settings shapes are not redefined here: they come from `src/shared` (one source of truth).
 */
import { z } from "zod";
import { AGENT_TASKS } from "../agent/index.js";
import { EVENT_KINDS, newEventSchema } from "../ledger/index.js";
import { JOB_STATUSES, boardLevelSchema, platformLoginSchema } from "../shared/index.js";

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

/**
 * Body of `PUT /api/platforms/:name`: the new sign-in way and/or apply level, and the platform name
 * typed again as confirmation (needed for saved sign-in or automatic level on linkedin, indeed or naukri).
 * Example: `{ "level": "auto", "confirm": "linkedin" }`. It never carries a password.
 */
export const platformBodySchema = z
  .object({
    login: platformLoginSchema.optional(),
    level: boardLevelSchema.optional(),
    confirm: z.string().max(60).optional(),
  })
  .strict()
  .refine((body) => body.login !== undefined || body.level !== undefined, {
    message: "Give a login way, an apply level, or both.",
  });

/** The most extra text a person may give an autopilot run. */
export const MAXIMUM_INSTRUCTION_CHARACTERS = 2000;

/**
 * Body of `POST /api/agent/start`: the kind of pass and an optional note for the model.
 * Example: `{ "task": "custom", "instruction": "Only look at remote roles today." }`.
 */
export const agentStartBodySchema = z
  .object({
    task: z.enum(AGENT_TASKS),
    instruction: z.string().trim().max(MAXIMUM_INSTRUCTION_CHARACTERS).optional(),
  })
  .strict();

/** Body of `PUT /api/goals`: the whole goals text. The goals store refuses text that is too long. */
export const goalsBodySchema = z.object({ text: z.string() }).strict();
