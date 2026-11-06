/**
 * The shapes the tracking module passes around: one parsed email and the label Scout gives it.
 *
 * Why it exists: every step (reading, classifying, matching, alert parsing) works on the same small
 * `ParsedMessage`, so none of them needs to know about raw email format or mail servers.
 *
 * Email text is untrusted data. Nothing in this module ever treats message text as an instruction.
 */
import { z } from "zod";

/**
 * One email, reduced to what Scout needs.
 *
 * Example: `{ id: "<a1@mail.example.com>", fromName: "Harbor Systems Talent", fromAddress:
 * "talent@harbor-systems.example.com", subject: "Interview invitation", date:
 * "2026-11-03T09:00:00.000Z", text: "We would like to ...", truncated: false }`.
 */
export interface ParsedMessage {
  /** The message's own id header, or a Scout-made id when the header is missing. Used to skip repeats. */
  id: string;
  /** Display name of the sender, or an empty string. Example: "Harbor Systems Talent". */
  fromName: string;
  /** Lower-case sender address, or an empty string. Example: "talent@harbor-systems.example.com". */
  fromAddress: string;
  subject: string;
  /** ISO timestamp from the Date header; absent when the header is missing or unreadable. */
  date?: string;
  /** Plain text of the message. HTML-only messages are converted to text. Capped in length. */
  text: string;
  /** True when `text` was cut because the message was longer than the cap. */
  truncated: boolean;
}

/**
 * What a message is about.
 * - `application-received`: an automatic "we got your application".
 * - `recruiter-message`: a person reaching out about a role.
 * - `interview-invite`: a request to schedule an interview or call about the application.
 * - `assessment`: a coding test, take-home task or similar.
 * - `rejection`: the company will not go on with the application.
 * - `offer`: the company offers the job.
 * - `other`: not about a job application (or hostile text that tries to give Scout orders).
 * - `ambiguous`: the rules are not sure; a caller may ask the model.
 */
export const MESSAGE_KINDS = [
  "application-received",
  "recruiter-message",
  "interview-invite",
  "assessment",
  "rejection",
  "offer",
  "other",
  "ambiguous",
] as const;

/** Type of one message kind, for example `"rejection"`. */
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** The kinds a model may answer with: every kind except `ambiguous`, which is a rules-only result. */
export const DECIDED_MESSAGE_KINDS = MESSAGE_KINDS.filter((kind) => kind !== "ambiguous");

/**
 * The result of classifying one message.
 *
 * Example: `{ kind: "rejection", confidence: 0.9, reasons: ["says it will not move forward"] }`.
 * A `confidence` below the module's threshold always comes with kind `ambiguous`.
 */
export interface Classification {
  kind: MessageKind;
  /** From 0 to 1. How sure the rules (or the model) are. */
  confidence: number;
  /** Plain-words reasons, so a person can see why the message got this label. */
  reasons: string[];
}

/** Shape of the model's answer when the rules are unsure. The model labels; it never acts. */
export const modelClassificationSchema = z.object({
  kind: z.enum(DECIDED_MESSAGE_KINDS as [string, ...string[]]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500),
});

/** Type of the model's classification answer. */
export type ModelClassification = z.infer<typeof modelClassificationSchema>;
