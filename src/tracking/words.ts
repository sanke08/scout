/**
 * Small word helpers shared by the matcher and the alert resolver: turning company names and job
 * titles into comparable pieces.
 */

/** Words in a company name that carry no identity: "Northwind Labs Inc" is "northwind labs". */
const COMPANY_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "corp",
  "corporation",
  "co",
  "pvt",
  "plc",
  "ag",
]);

/** Words in a job title that say nothing about which job it is. */
const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "the",
  "to",
  "with",
  "i",
  "ii",
  "iii",
  "remote",
  "hybrid",
  "m",
  "f",
  "d",
]);

/** Lower-cases `text` and returns its runs of letters and digits. Example: "Node.js Dev" gives ["node", "js", "dev"]. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The words that identify a company, without legal suffixes.
 * Example: `companyWords("Northwind Labs, Inc.")` is ["northwind", "labs"].
 */
export function companyWords(company: string): string[] {
  const words = wordsOf(company).filter((word) => !COMPANY_SUFFIXES.has(word));
  return words.length > 0 ? words : wordsOf(company);
}

/**
 * The company name squashed into one lower-case token, for comparing with a domain name.
 * Example: `companySlug("Harbor Systems")` is "harborsystems".
 */
export function companySlug(company: string): string {
  return companyWords(company).join("");
}

/** The words of a job title that identify the role. Example: "Senior Backend Engineer (Remote)" gives ["senior", "backend", "engineer"]. */
export function titleWords(title: string): string[] {
  return wordsOf(title).filter((word) => !TITLE_STOP_WORDS.has(word));
}
