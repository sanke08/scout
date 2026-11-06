/**
 * The shape of every input the API accepts, checked with zod before anything is used. The profile
 * and settings shapes are not redefined here: they come from `src/shared` (one source of truth).
 */
import { z } from "zod";

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
