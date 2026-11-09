/**
 * The user's standing wishes in their own words, kept in one plain file: `<data>/goals.md`.
 *
 * Why it exists: in autopilot the model decides what to look for, what to skip and how to behave,
 * guided by what the user wrote here (roles, places, pay, companies to avoid, how much to say about
 * themselves). It replaces predefined filter rules: the user edits plain text, not settings.
 *
 * Example: `createGoalsStore(dir).save("Backend roles, remote, no crypto")` then `.load()` gives it back.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeTextAtomic } from "../folders/index.js";
import { ScoutError } from "../shared/index.js";
import type { GoalsStore } from "./types.js";

/** The file name inside the data folder. */
export const GOALS_FILE_NAME = "goals.md";

/** The most text a goals file may hold. */
export const MAXIMUM_GOALS_CHARACTERS = 20_000;

/** What a new user sees until they write their own. */
export const STARTER_GOALS = `Write here, in your own words, what you want Scout to find and how it should behave.

Examples (replace all of this):
- Roles: backend or platform engineer, mid to senior.
- Where: remote anywhere in Europe, or Berlin.
- Pay: not below 60k EUR a year.
- Avoid: gambling, crypto, agencies that do not name the client.
- Tone: short, plain cover notes; never claim skills I do not have.
`;

/** True while the text is still the starter text (or empty), so autopilot should not start. */
export function goalsAreStarter(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || trimmed === STARTER_GOALS.trim();
}

/** Creates the store over `<directory>/goals.md`. */
export function createGoalsStore(directory: string): GoalsStore {
  const path = join(directory, GOALS_FILE_NAME);
  return {
    load() {
      return existsSync(path) ? readFileSync(path, "utf8") : STARTER_GOALS;
    },
    save(text) {
      if (text.length > MAXIMUM_GOALS_CHARACTERS) {
        throw new ScoutError(
          "invalid-input",
          `The goals text is longer than ${MAXIMUM_GOALS_CHARACTERS} characters. Shorten it.`,
        );
      }
      mkdirSync(dirname(path), { recursive: true });
      writeTextAtomic(path, text);
    },
  };
}
