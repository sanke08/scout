/**
 * Small helpers for the JSON files this module owns (the profile file and the proposals file).
 *
 * They exist so both files are read, validated and written the same way: errors are full
 * sentences, a file written by a newer Scout is refused untouched, and a write never leaves a
 * half-written file behind.
 *
 * Example: `writeJsonAtomically("/data/profile.json", profile)` leaves either the old complete
 * file or the new complete file on disk, never a mix.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { ScoutError } from "../shared/index.js";

/**
 * Turns a zod issue path into text a person can find in the file.
 *
 * Example: `["experience", 0, "points", 1, "status"]` becomes `experience[0].points[1].status`.
 * An empty path (the whole file is wrong) becomes `the top level of the file`.
 */
export function describeIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "the top level of the file";
  }
  let text = "";
  for (const part of path) {
    if (typeof part === "number") {
      text += `[${part}]`;
    } else {
      text += text === "" ? String(part) : `.${String(part)}`;
    }
  }
  return text;
}

/**
 * Turns the first problem found by a zod schema into one full sentence naming the field path.
 *
 * Example: for `{ identity: { name: 5 } }` against the profile schema, with `what` set to
 * `the profile file at /data/profile.json`, it returns a sentence that names `identity.name`.
 */
export function describeFirstIssue(error: z.ZodError, what: string): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return `${capitalise(what)} is not valid. Fix the file by hand and try again.`;
  }
  const where = describeIssuePath(issue.path);
  return `${capitalise(what)} is not valid: the field ${where} is wrong (${issue.message}). Fix that field by hand and try again.`;
}

/** Upper-cases the first letter so a phrase such as "the profile file" can start a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reads and parses a JSON file.
 *
 * Returns `undefined` when the file does not exist, so the caller decides whether that is an
 * error (the profile) or normal (no proposals yet). Throws `invalid-input` for text that is not
 * JSON and `unavailable` when the file exists but cannot be read.
 */
export function readJsonFile(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw new ScoutError(
      "unavailable",
      `Scout could not read ${what} at ${path} (${describeError(error)}). Check that the file is readable and try again.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ScoutError(
      "invalid-input",
      `${capitalise(what)} at ${path} is not valid JSON (${describeError(error)}). Fix the file by hand, for example a missing comma or quote, and try again.`,
    );
  }
}

/**
 * Refuses a file written by a newer Scout, without touching it.
 *
 * `raw` is the parsed file, `supported` is the newest `schemaVersion` this code understands.
 * Example: a file with `"schemaVersion": 2` while `supported` is 1 throws `invalid-input` that
 * tells the user to update Scout; the file stays exactly as it was.
 */
export function refuseNewerSchema(raw: unknown, supported: number, what: string, path: string) {
  if (typeof raw !== "object" || raw === null || !("schemaVersion" in raw)) {
    return;
  }
  const found = raw.schemaVersion;
  if (typeof found === "number" && found > supported) {
    throw new ScoutError(
      "invalid-input",
      `${capitalise(what)} at ${path} was written by a newer Scout (file format ${found}, this Scout understands up to ${supported}). Update Scout; the file was left untouched.`,
    );
  }
}

/**
 * Writes a value as pretty JSON (two-space indent, final newline) so a person can edit it.
 *
 * It writes to a temporary file in the same folder and then renames it over the target, because
 * a rename is atomic: a crash leaves the old file or the new file, never half of one. The folder
 * is created if it is missing. Throws `unavailable` when the write fails; the temporary file is
 * removed.
 */
export function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw new ScoutError(
      "unavailable",
      `Scout could not save the file at ${path} (${describeError(error)}). Check the folder exists and is writable, then try again.`,
    );
  }
}

/** True when a Node file error means "no such file". */
function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The plain message of any thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
