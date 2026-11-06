/**
 * Small helpers every board parser shares: safe JSON reading and turning a token into a
 * readable company name.
 *
 * Board responses are untrusted. A response that is not what the board promised is rejected with
 * a clear `invalid-input` error that names the board.
 */
import { ScoutError } from "../shared/index.js";

/** A plain JSON object whose fields are not yet checked. */
export type JsonObject = Record<string, unknown>;

/** True when `value` is a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads JSON text. Example: `readJson('{"jobs":[]}', "greenhouse:examplecorp")` gives `{ jobs: [] }`.
 * Failure: text that is not valid JSON throws `ScoutError("invalid-input")` naming the board.
 */
export function readJson(body: string, boardName: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ScoutError(
      "invalid-input",
      `The ${boardName} board did not return valid JSON, so nothing was read from it. Check the board token and try again later.`,
    );
  }
}

/**
 * Returns the list stored under `key` in a JSON object (or the value itself when `key` is
 * undefined and the value is a list). Entries are not checked here.
 * Failure: any other shape throws `ScoutError("invalid-input")` naming the board.
 */
export function readEntries(value: unknown, key: string | undefined, boardName: string): unknown[] {
  const list = key === undefined ? value : isJsonObject(value) ? value[key] : undefined;
  if (!Array.isArray(list)) {
    const expected = key === undefined ? "a list of jobs" : `a "${key}" list of jobs`;
    throw new ScoutError(
      "invalid-input",
      `The ${boardName} board returned data in an unexpected shape (expected ${expected}), so nothing was read from it.`,
    );
  }
  return list as unknown[];
}

/** Returns `value` when it is a non-empty string, otherwise undefined. */
export function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Makes a readable company name from a board token.
 * Example: "harbor-systems" gives "Harbor Systems"; "examplecorp" gives "Examplecorp".
 */
export function companyFromToken(token: string): string {
  return token
    .split(/[-_.]+/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
