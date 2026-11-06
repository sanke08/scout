/**
 * The folder-naming rules for job folders.
 *
 * A job folder is named `YYYY-MM-DD_Company_Role`: the date the folder was created, the employer
 * in CamelCase with no punctuation, and a short role slug. The name is made once and never
 * changed afterwards (IDEA 5.11), so the rules here only run when a folder is first created.
 *
 * Example: `makeFolderName(new Date("2026-11-07T10:00:00Z"), "Acme, Inc.", "Senior Backend Engineer (Remote)")`
 * is `2026-11-07_AcmeInc_Senior-Backend-Engineer`. An empty company becomes `Unknown`.
 * Failure: these functions do not throw; text with no usable letters becomes `Unknown`.
 */
import { isoDate } from "./time-format.js";

/** Placeholder used when the employer or the role cannot be read. */
export const UNKNOWN_NAME = "Unknown";

/** Most characters kept from a company name. */
const LONGEST_COMPANY = 40;

/** Most words kept from a role title. */
const MOST_ROLE_WORDS = 4;

/** Most characters kept from a role slug. */
const LONGEST_ROLE = 40;

/** Removes accents and every character that is not a plain letter or digit, keeping word breaks. */
function splitIntoWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
}

/** Upper-cases the first letter of a word and keeps the rest, so `ExampleCorp` stays as it is. */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turns an employer name into CamelCase without punctuation.
 * Example: `"acme, inc."` gives `AcmeInc`; `"  "` gives `Unknown`.
 */
export function camelCaseCompany(company: string): string {
  const joined = splitIntoWords(company).map(capitalise).join("");
  return joined === "" ? UNKNOWN_NAME : joined.slice(0, LONGEST_COMPANY);
}

/**
 * Turns a job title into a short hyphenated slug of at most four words.
 * Text in brackets is dropped first, since it is usually a location or a team.
 * Example: `"Senior Backend Engineer (Remote)"` gives `Senior-Backend-Engineer`.
 */
export function roleSlug(title: string): string {
  const withoutBrackets = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const words = splitIntoWords(withoutBrackets).slice(0, MOST_ROLE_WORDS).map(capitalise);
  const slug = words.join("-");
  return slug === "" ? UNKNOWN_NAME : slug.slice(0, LONGEST_ROLE).replace(/-+$/, "");
}

/**
 * The base name of a new job folder, before any `-A` style ending is added.
 * Example: `2026-11-07_Acme_Backend-Engineer`.
 */
export function makeFolderName(created: Date, company: string, title: string): string {
  return `${isoDate(created)}_${camelCaseCompany(company)}_${roleSlug(title)}`;
}

/**
 * Turns a number into the letters `A`, `B`, ... `Z`, `AA`, `AB`, ... (0 is `A`).
 * Used for the endings that tell two postings of the same role apart.
 */
export function letterSuffix(index: number): string {
  let letters = "";
  let remaining = index;
  while (remaining >= 0) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letters;
}

/** Lower-case letters and digits only; used to compare company and role between folders. */
export function comparisonKey(text: string): string {
  return splitIntoWords(text).join("").toLowerCase();
}
