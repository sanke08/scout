/**
 * Canonical addresses and stable posting ids.
 *
 * The same job is often linked with tracking parameters added by a campaign, a referrer or a
 * board. Scout removes those so that one job has one address and therefore one id.
 */
import { createHash } from "node:crypto";
import { ScoutError } from "../shared/index.js";

/** Query parameters that only record where a visitor came from, never which job it is. */
const TRACKING_PARAMETER_NAMES = new Set([
  "gh_src",
  "lever-source",
  "lever-origin",
  "fbclid",
  "gclid",
]);

/** Query parameter name prefixes that only record where a visitor came from. */
const TRACKING_PARAMETER_PREFIXES = ["utm_"];

/** True when a query parameter only carries tracking information. */
function isTrackingParameter(name: string): boolean {
  const lowerName = name.toLowerCase();
  if (TRACKING_PARAMETER_NAMES.has(lowerName)) return true;
  return TRACKING_PARAMETER_PREFIXES.some((prefix) => lowerName.startsWith(prefix));
}

/**
 * Returns the canonical form of a job address: lower-case host, no fragment, no tracking
 * parameters, remaining parameters sorted, no trailing slash on the path.
 *
 * Example: `https://Jobs.Example.com/a/1/?utm_source=x&b=2&a=1#apply` becomes
 * `https://jobs.example.com/a/1?a=1&b=2`.
 * Failure: an address that is not a valid http or https URL throws `ScoutError("invalid-input")`.
 */
export function canonicalizeUrl(address: string): string {
  let parsed: URL;
  try {
    parsed = new URL(address.trim());
  } catch {
    throw new ScoutError("invalid-input", `The address "${address}" is not a valid web address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ScoutError(
      "invalid-input",
      `The address "${address}" is not an http or https address.`,
    );
  }
  parsed.hash = "";
  const keptParameters: [string, string][] = [];
  for (const [name, value] of parsed.searchParams) {
    if (!isTrackingParameter(name)) keptParameters.push([name, value]);
  }
  keptParameters.sort(([nameA, valueA], [nameB, valueB]) =>
    nameA === nameB ? valueA.localeCompare(valueB) : nameA.localeCompare(nameB),
  );
  parsed.search = new URLSearchParams(keptParameters).toString();
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

/**
 * Returns the stable posting id: the first 16 hex characters of the SHA-256 of the canonical
 * address.
 *
 * Example: two links that differ only by `?utm_source=news` give the same id.
 * Failure: an invalid address throws `ScoutError("invalid-input")` (see `canonicalizeUrl`).
 */
export function postingIdFromUrl(address: string): string {
  return createHash("sha256").update(canonicalizeUrl(address)).digest("hex").slice(0, 16);
}
