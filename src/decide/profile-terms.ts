/**
 * The words that describe the user's skills, derived from the profile.
 *
 * Why: keyword ranking needs a list of terms to look for. The profile is the single source of
 * truth, so the terms come from it and from nothing else: skills rows and the `allowed` lists of
 * points the user can use (status `confirmed` or `from code`). Points that are `hold`,
 * `ask first` or `excluded`, and anything in `neverUsed`, contribute nothing, so a ranking can
 * never credit the user with a skill they have not confirmed.
 *
 * Example: a skills row item "JavaScript (ES6+)" gives the terms "javascript (es6+)" and
 * "javascript".
 */
import { USABLE_POINT_STATUSES, type Point, type Profile } from "../shared/index.js";
import { normaliseText } from "./text-match.js";

/** Removes a trailing bracketed note. Example: `"JavaScript (ES6+)"` becomes `"JavaScript"`. */
function withoutBrackets(item: string): string {
  return item.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

/** Adds an item and its bracket-free form to `terms`. */
function addTerm(terms: Set<string>, item: string): void {
  const full = normaliseText(item);
  if (full === "") return;
  terms.add(full);
  const short = normaliseText(withoutBrackets(item));
  if (short !== "") terms.add(short);
}

/** Adds the `allowed` terms of one point when the user can use that point. */
function addPointTerms(terms: Set<string>, point: Point): void {
  if (!USABLE_POINT_STATUSES.includes(point.status)) return;
  for (const item of point.allowed) addTerm(terms, item);
}

/**
 * Returns the profile's terms, lower-cased, without duplicates, in first-seen order.
 * Never contains anything from `profile.neverUsed`. Does not read any contact detail.
 */
export function termsOfProfile(profile: Profile): string[] {
  const terms = new Set<string>();
  for (const row of profile.skills) {
    for (const item of row.items) addTerm(terms, item);
  }
  for (const entry of profile.experience) {
    for (const point of entry.points) addPointTerms(terms, point);
  }
  for (const project of profile.projects) {
    for (const point of project.points) addPointTerms(terms, point);
  }
  const forbidden = new Set(profile.neverUsed.map(normaliseText));
  return [...terms].filter((term) => !forbidden.has(term));
}
