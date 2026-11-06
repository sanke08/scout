/**
 * The structured note the model must return for one project, checked with zod.
 *
 * Why: the note is data, not prose. A reply that does not fit this shape is retried once by the
 * brain and then reported as a failure, so nothing half-formed is ever written.
 */
import { z } from "zod";

/** The four honest answers to "is this project real?". */
export const PROJECT_VERDICTS = ["real project", "tutorial copy", "demo", "unfinished"] as const;

/** How far a feature really goes: working in the code, partly there, or only described. */
export const FEATURE_STATUSES = ["built", "half-built", "described-only"] as const;

/** The longest text the schema accepts for one field; keeps a runaway reply from being written. */
const MAXIMUM_TEXT_LENGTH = 600;

/** A bounded, non-empty piece of text. */
const shortText = z.string().trim().min(1).max(MAXIMUM_TEXT_LENGTH);

/**
 * One feature of the project.
 * - `name`: a short name such as "Message leases".
 * - `howItWorks`: how the code does it, in plain words.
 * - `status`: built, half-built or described-only (in the README but not in the code).
 * - `designDecisions`: choices made and why; may be empty.
 * - `failureHandling`: what happens when it goes wrong; empty text when the code does not say.
 */
export const featureSchema = z.object({
  name: shortText,
  howItWorks: shortText,
  status: z.enum(FEATURE_STATUSES),
  designDecisions: z.array(shortText).max(6),
  failureHandling: z.string().trim().max(MAXIMUM_TEXT_LENGTH),
});

/** A real number found in the project, with the figure exactly as written and what it measures. */
export const numberSchema = z.object({
  figure: shortText,
  meaning: shortText,
});

/**
 * What the model returns for one project.
 * - `title`: the project's name.
 * - `overview`: what it is, in one or two sentences.
 * - `verdict`: `kind` and the `reason` for it.
 * - `stack`: technologies the project uses.
 * - `features`: what it does.
 * - `numbers`: figures that appear in the configuration or code (never invented).
 * - `doNotClaim`: statements the user must not make about it.
 */
export const projectNoteReplySchema = z.object({
  title: shortText,
  overview: shortText,
  verdict: z.object({ kind: z.enum(PROJECT_VERDICTS), reason: shortText }),
  stack: z.array(shortText).max(40),
  features: z.array(featureSchema).max(20),
  numbers: z.array(numberSchema).max(20),
  doNotClaim: z.array(shortText).max(20),
});

/** The inferred type of `projectNoteReplySchema`. */
export type ProjectNoteReply = z.infer<typeof projectNoteReplySchema>;
