/**
 * A `Brain` that replays recorded replies, for tests across the whole project.
 *
 * Why it exists: no test may use a real model. The fake goes through the same reply checking as the
 * real brain (JSON extraction, schema validation, one retry), so a test that passes with the fake
 * cannot be passing only because validation was skipped.
 */
import type { Brain, BrainRequest, BrainResult } from "../shared/index.js";
import { askUntilValid, type EngineReply } from "./reply-pipeline.js";

/**
 * One recorded engine reply. Set `task` to make it answer only requests with that task name;
 * leave it out to answer any request, in order.
 * - `value`: the engine returns this value as JSON. Example: `{ kind: "value", value: { score: 7 } }`.
 * - `text`: the engine returns this raw text (use it for prose around JSON or for bad output).
 *   Example: `{ kind: "text", text: "not json" }` simulates "invalid-output" (twice, if repeated).
 * - `limit-reached`: the engine reports its usage limit. Example: `{ kind: "limit-reached", resetAt }`.
 * - `unavailable`: the engine cannot be run.
 */
export type RecordedReply = { task?: string } & (
  | { kind: "value"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "limit-reached"; resetAt?: string }
  | { kind: "unavailable"; message?: string }
);

/** A fake brain, plus ways for a test to look at what happened. */
export interface FakeBrain extends Brain {
  /** Every prompt received, in order (retries included). */
  readonly receivedPrompts: readonly string[];
  /** How many recorded replies have not been used yet. */
  remainingReplies(): number;
}

/** Turns a recorded reply into what a real engine call would have returned. */
function toEngineReply(recorded: RecordedReply): EngineReply {
  switch (recorded.kind) {
    case "value":
      return { kind: "text", text: JSON.stringify(recorded.value) };
    case "text":
      return { kind: "text", text: recorded.text };
    case "limit-reached":
      return recorded.resetAt ? { kind: "limit", resetAt: recorded.resetAt } : { kind: "limit" };
    case "unavailable":
      return {
        kind: "unavailable",
        message: recorded.message ?? "The fake engine is unavailable.",
      };
  }
}

/**
 * Creates a fake brain.
 *
 * Replies are used once each. A request with task "score" takes the first unused reply recorded
 * for "score", or else the first unused reply with no task. With nothing left it answers
 * "unavailable" (a failure value, never an exception).
 *
 * Example: `createFakeBrain([{ kind: "value", task: "score", value: { score: 7 } }])` answers the
 * first "score" request with `{ ok: true, value: { score: 7 }, engine: "fake", cached: false }`.
 * `name` is the engine name reported in results; give two fakes different names to test fallback.
 */
export function createFakeBrain(recordedReplies: RecordedReply[], name = "fake"): FakeBrain {
  const unused = [...recordedReplies];
  const receivedPrompts: string[] = [];

  const takeReplyFor = (task: string): RecordedReply | undefined => {
    let index = unused.findIndex((recorded) => recorded.task === task);
    if (index === -1) index = unused.findIndex((recorded) => recorded.task === undefined);
    if (index === -1) return undefined;
    return unused.splice(index, 1)[0];
  };

  return {
    name,
    receivedPrompts,
    remainingReplies: () => unused.length,
    run<T>(request: BrainRequest<T>): Promise<BrainResult<T>> {
      return askUntilValid(name, request, async (prompt) => {
        receivedPrompts.push(prompt);
        const recorded = takeReplyFor(request.task);
        if (!recorded) {
          return {
            kind: "unavailable",
            message: `The fake brain has no recorded reply left for task "${request.task}".`,
          };
        }
        return toEngineReply(recorded);
      });
    },
  };
}
