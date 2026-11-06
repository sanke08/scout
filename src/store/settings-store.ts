/**
 * The settings store: one pretty-printed JSON file holding the Settings view's values.
 * Implements `SettingsStore` from `src/shared/ports.ts`, plus the kill-switch helper.
 *
 * Rules: a missing file gives the defaults; a missing field takes its default; an unknown field or
 * a wrong value is refused with an error naming the field; saving writes a temporary file and then
 * renames it, so a crash can never leave half a file.
 *
 * Example: a file containing `{"dailyApplicationLimit": 3}` loads as the defaults with that one
 * limit changed.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SETTINGS, ScoutError, settingsSchema } from "../shared/index.js";
import type { Settings, SettingsStore } from "../shared/index.js";

/** Describes the first problem a zod check found as "field: what is wrong", for error messages. */
function describeFirstProblem(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "unknown problem";
  }
  const field = issue.path.length === 0 ? "the file" : issue.path.map(String).join(".");
  return `"${field}": ${issue.message}`;
}

/**
 * Turns raw parsed JSON into valid `Settings`: rejects anything that is not an object or has an
 * unknown field, fills missing fields from `DEFAULT_SETTINGS`, then validates every value.
 * `source` names the file in error messages. Failure: `ScoutError("invalid-input")` naming the field.
 */
function settingsFromRawValue(raw: unknown, source: string): Settings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ScoutError(
      "invalid-input",
      `The settings in ${source} must be a JSON object of setting names and values.`,
    );
  }
  const knownFields = Object.keys(settingsSchema.shape);
  for (const field of Object.keys(raw)) {
    if (!knownFields.includes(field)) {
      throw new ScoutError(
        "invalid-input",
        `The settings in ${source} contain an unknown field "${field}". Remove it or fix the spelling.`,
      );
    }
  }
  const result = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...raw });
  if (!result.success) {
    throw new ScoutError(
      "invalid-input",
      `The settings in ${source} have an invalid value for ${describeFirstProblem(result.error)}. Fix that value and try again.`,
    );
  }
  return result.data;
}

/**
 * Creates a settings store reading and writing the JSON file at `path`.
 * Example: `createSettingsStore("/data/settings.json").load()` returns every setting.
 * Failures: a file that is not valid JSON, has an unknown field or a wrong value gives
 * `ScoutError("invalid-input")`; an unreadable file gives `ScoutError("unavailable")`.
 */
export function createSettingsStore(path: string): SettingsStore {
  return {
    load() {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return structuredClone(DEFAULT_SETTINGS);
        }
        throw new ScoutError(
          "unavailable",
          `The settings file ${path} could not be read. Check its permissions.`,
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ScoutError(
          "invalid-input",
          `The settings file ${path} is not valid JSON. Fix it by hand or delete it to return to the defaults.`,
        );
      }
      return settingsFromRawValue(raw, path);
    },

    save(settings) {
      const valid = settingsFromRawValue(settings, "the settings being saved");
      const temporaryPath = join(dirname(path), `.settings-${process.pid}-${Date.now()}.tmp`);
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temporaryPath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
        renameSync(temporaryPath, path);
      } catch {
        rmSync(temporaryPath, { force: true });
        throw new ScoutError(
          "unavailable",
          `The settings could not be saved to ${path}. Check the folder is writable.`,
        );
      }
      return valid;
    },
  };
}

/**
 * The kill switch every acting module calls first. Throws `ScoutError("paused")` when
 * `automationPaused` is true; returns quietly otherwise.
 * Example: `assertNotPaused({ ...DEFAULT_SETTINGS, automationPaused: true })` throws.
 */
export function assertNotPaused(settings: Settings): void {
  if (settings.automationPaused) {
    throw new ScoutError(
      "paused",
      "Automation is paused, so Scout will not submit or fill forms. Turn the pause off in Settings to continue.",
    );
  }
}
