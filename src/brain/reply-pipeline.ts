/**
 * The shared path from "ask the engine" to "a checked value or a failure value".
 *
 * Why it exists: the real command brain and the fake brain must treat replies identically
 * (extract the JSON, check the schema, retry once, give up with a failure value), so both use this
 * one function and differ only in how they obtain the engine's raw text.
 */
import type { BrainRequest, BrainResult } from "../shared/index.js";
import { extractFirstJson } from "./json-extract.js";
import { buildPrompt } from "./prompt.js";

/** A failed `BrainResult`, for code that only handles the failure side. */
export type BrainFailure = Extract<BrainResult<unknown>, { ok: false }>;

/** What one call to an engine produced, before any checking. */
export type EngineReply =
  | { kind: "text"; text: string }
  | { kind: "limit"; resetAt?: string }
  | { kind: "unavailable"; message: string };

/** Sends one finished prompt to an engine and reports what came back. Never throws. */
export type EngineCall = (prompt: string) => Promise<EngineReply>;

/** How many times the engine may be asked about one request: the first try plus one retry. */
const MAXIMUM_ATTEMPTS = 2;

/** Longest correction detail kept, so a long validation message cannot bloat the retry prompt. */
const MAXIMUM_PROBLEM_LENGTH = 300;

/** Builds the failure value for a reported usage limit. Example: `limitFailure("claude", iso)`. */
export function limitFailure(engine: string, resetAt?: string): BrainFailure {
  const when = resetAt ? ` It resets at ${resetAt}.` : "";
  const failure: BrainFailure = {
    ok: false,
    reason: "limit-reached",
    message: `The ${engine} usage limit is reached.${when}`,
  };
  if (resetAt) failure.resetAt = resetAt;
  return failure;
}

/**
 * Checks one raw reply against the schema.
 * Returns the value, or a short sentence naming the problem (used in the correction message).
 * Example: text "I cannot help" gives `{ problem: "The reply contained no JSON object or array." }`.
 */
function checkReply<T>(text: string, request: BrainRequest<T>): { value: T } | { problem: string } {
  const found = extractFirstJson(text);
  if (!found.found) return { problem: "The reply contained no JSON object or array." };
  const checked = request.schema.safeParse(found.value);
  if (checked.success) return { value: checked.data };
  const issues = checked.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`)
    .join("; ");
  return {
    problem: `The JSON did not match the schema (${issues}).`.slice(0, MAXIMUM_PROBLEM_LENGTH),
  };
}

/**
 * Asks the engine, checks the reply, and retries once with a correction naming the problem.
 *
 * Example: first reply "sorry" then `{"score":3}` for a score schema gives `{ ok: true, value: { score: 3 } }`;
 * two bad replies give `{ ok: false, reason: "invalid-output", ... }`.
 * A limit or an unavailable engine stops at once (no retry). Never throws for model problems.
 */
export async function askUntilValid<T>(
  engine: string,
  request: BrainRequest<T>,
  callEngine: EngineCall,
): Promise<BrainResult<T>> {
  let correction: string | undefined;
  let lastProblem = "";
  for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
    const reply = await callEngine(buildPrompt(request, correction));
    if (reply.kind === "limit") return limitFailure(engine, reply.resetAt);
    if (reply.kind === "unavailable") {
      return { ok: false, reason: "unavailable", message: reply.message };
    }
    const checked = checkReply(reply.text, request);
    if ("value" in checked) return { ok: true, value: checked.value, engine, cached: false };
    lastProblem = checked.problem;
    correction = `Your previous reply was rejected. ${checked.problem} Reply again with only the corrected JSON.`;
  }
  return {
    ok: false,
    reason: "invalid-output",
    message: `The ${engine} reply was still invalid after one retry. ${lastProblem}`,
  };
}
