/**
 * Asking the model for a better wording of one profile point, with the claim check as a gate
 * (scenario F). The result is only a proposal: the caller keeps it pending until the user approves.
 */
import { z } from "zod";
import type { Brain, Point } from "../shared/index.js";
import { checkClaims, claimRetryInstructions, type UnsupportedClaim } from "./claims.js";
import type { BrainFailure } from "./reply-pipeline.js";

/** The part of a profile point the wording request needs. */
export type WordingPoint = Pick<Point, "text" | "allowed">;

/** Extra facts the proposal may rely on. */
export interface ProposeWordingOptions {
  /** Other profile facts that are true and may be used. Example: ["Mentored two juniors"]. */
  knownFacts?: string[];
}

/** Either an approved-for-review wording, or the reason there is none. */
export type ProposeWordingResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unsupported-claims"; message: string; unsupported: UnsupportedClaim[] }
  | { ok: false; reason: BrainFailure["reason"]; message: string; resetAt?: string };

/** How many times the model is asked again after a failed claim check. */
const MAXIMUM_CLAIM_RETRIES = 2;

/** The shape of the model's reply: one new wording. */
const wordingReplySchema = z.object({ text: z.string().min(1) });

/** The instructions for the first attempt. The point's own text is the user's, not outside data. */
function buildWordingInstructions(point: WordingPoint): string {
  return [
    "Write one better wording of the resume point below, as a single resume bullet in plain words.",
    `Use ONLY these terms: ${point.allowed.length > 0 ? point.allowed.join(", ") : "(none)"}.`,
    "Do not add any technology, number, percentage, team size, job title, year or other fact that is",
    "not in the original point or in the term list above.",
    `Original point: ${point.text}`,
    'Reply with {"text": "<the new wording>"}.',
  ].join("\n");
}

/**
 * Asks `brain` for a new wording of `point`, checks its claims, and asks again (up to 2 more times,
 * with a correction naming the unsupported claims) while the check fails.
 *
 * Example: for the point "Mentored two juniors" the reply "Led a team of eight" is blocked and the
 * next reply "Mentored two junior developers" passes: `{ ok: true, text: "Mentored two junior developers" }`.
 * If every attempt is blocked the result is `{ ok: false, reason: "unsupported-claims", ... }` and
 * the caller asks the user. If the brain itself fails (limit, unavailable, invalid output), that
 * failure is returned at once.
 */
export async function proposeWording(
  brain: Brain,
  point: WordingPoint,
  options: ProposeWordingOptions = {},
): Promise<ProposeWordingResult> {
  const support = {
    allowedTerms: point.allowed,
    knownFacts: [point.text, ...(options.knownFacts ?? [])],
  };
  const baseInstructions = buildWordingInstructions(point);
  let instructions = baseInstructions;
  let unsupported: UnsupportedClaim[] = [];

  for (let attempt = 0; attempt <= MAXIMUM_CLAIM_RETRIES; attempt += 1) {
    const reply = await brain.run({
      task: "propose-wording",
      instructions,
      schema: wordingReplySchema,
    });
    if (!reply.ok) {
      return reply.resetAt
        ? { ok: false, reason: reply.reason, message: reply.message, resetAt: reply.resetAt }
        : { ok: false, reason: reply.reason, message: reply.message };
    }
    const checked = checkClaims(reply.value.text, support);
    if (checked.unsupported.length === 0) return { ok: true, text: reply.value.text };
    unsupported = checked.unsupported;
    instructions = `${baseInstructions}\n\n${claimRetryInstructions(unsupported)}`;
  }
  return {
    ok: false,
    reason: "unsupported-claims",
    message:
      "The model kept proposing claims the profile does not support, so the user must decide.",
    unsupported,
  };
}
