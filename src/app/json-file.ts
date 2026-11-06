/**
 * Reading and writing the small JSON files the app module owns (`boards.json`, `scores.json`).
 *
 * Why it exists: both files must survive a crash mid-write and must say what is wrong with them
 * in plain words. Writing goes through a temporary file and a rename, so a reader never sees half
 * a file.
 *
 * Example: `writeJsonFile("/data/boards.json", { schemaVersion: 1, boards: [] })` then
 * `readJsonFile("/data/boards.json", "the board list")` gives the same object back.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ScoutError } from "../shared/index.js";

/**
 * Reads and parses a JSON file. Returns `undefined` when the file does not exist.
 * `what` names the file in error messages, for example "the board list".
 * Failure: a file that is not valid JSON gives `ScoutError("invalid-input")` naming the path.
 */
export function readJsonFile(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ScoutError(
      "unavailable",
      `Scout could not read ${what} at ${path}. Check that the file is readable.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ScoutError(
      "invalid-input",
      `${capitalise(what)} at ${path} is not valid JSON. Fix the file by hand or delete it to start again.`,
    );
  }
}

/**
 * Writes `value` as readable JSON (two-space indent), through a temporary file and a rename.
 * Failure: an unwritable folder gives `ScoutError("unavailable")`.
 */
export function writeJsonFile(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } catch {
    rmSync(temporaryPath, { force: true });
    throw new ScoutError(
      "unavailable",
      `Scout could not write ${path}. Check that the folder is writable.`,
    );
  }
}

/** Upper-cases the first letter. Example: "the board list" gives "The board list". */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
