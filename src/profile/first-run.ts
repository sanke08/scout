/**
 * The first-run requirements: the fields the user must fill before any pipeline stage runs.
 *
 * Scout interviews the user first; this module only reports what is still empty, so a caller can
 * refuse to run until the list is empty.
 *
 * Example: a profile with no salary floor returns a list containing the entry for
 * `preferences.salaryFloor`.
 */
import type { Profile } from "../shared/index.js";

/** One required field that is still empty: where it lives and what to ask the user. */
export interface MissingField {
  /** Dotted path in the profile, e.g. "preferences.salaryFloor". */
  path: string;
  /** What to ask, in plain words, e.g. "What is the lowest salary you will accept?". */
  question: string;
}

/** True when the text has something other than spaces in it. */
function isFilled(text: string): boolean {
  return text.trim() !== "";
}

/** True when the list has at least one non-blank item. */
function hasItems(items: readonly string[]): boolean {
  return items.some(isFilled);
}

/**
 * Lists the required first-run fields that are still empty, in the order to ask them.
 *
 * Required: identity name and location, at least one target role, at least one location, a
 * salary floor, a notice period (0 days counts as filled) and at least one work authorization.
 * Blank text counts as empty. An empty result means the pipeline may run.
 */
export function missingRequiredFields(profile: Profile): MissingField[] {
  const missing: MissingField[] = [];
  const require = (isPresent: boolean, path: string, question: string): void => {
    if (!isPresent) {
      missing.push({ path, question });
    }
  };
  const { identity, preferences } = profile;
  require(isFilled(identity.name), "identity.name", "What is your full name?");
  require(isFilled(identity.location), "identity.location", "Where do you live?");
  require(hasItems(
    preferences.targetRoles,
  ), "preferences.targetRoles", "Which job titles are you looking for?");
  require(hasItems(
    preferences.locations,
  ), "preferences.locations", "Which cities or regions will you work in?");
  require(preferences.salaryFloor !==
    undefined, "preferences.salaryFloor", "What is the lowest salary you will accept, and per year or per month?");
  require(preferences.noticePeriodDays !==
    undefined, "preferences.noticePeriodDays", "How many days of notice do you need before starting?");
  require(hasItems(
    preferences.workAuthorization,
  ), "preferences.workAuthorization", "Where are you legally allowed to work?");
  return missing;
}
