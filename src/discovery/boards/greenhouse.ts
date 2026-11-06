/**
 * Reads a Greenhouse public job board: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`.
 *
 * The response is `{ "jobs": [ { title, absolute_url, location: { name }, content, ... } ] }`.
 * `content` is the description as escaped HTML.
 */
import type { Posting } from "../../shared/index.js";
import { buildPosting, type RawPosting } from "../normalise.js";
import type { Salary } from "../salary.js";
import {
  companyFromToken,
  isJsonObject,
  readEntries,
  readJson,
  textOf,
  type JsonObject,
} from "../parse-helpers.js";

/** Builds the address of a Greenhouse board's job list for a board token. */
export function greenhouseUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

/** Reads the first pay range Greenhouse publishes for a job (amounts are in cents), if any. */
function readPayRange(entry: JsonObject): Salary | undefined {
  const ranges = entry["pay_input_ranges"];
  if (!Array.isArray(ranges) || !isJsonObject(ranges[0])) return undefined;
  const range = ranges[0];
  const minCents = range["min_cents"];
  const maxCents = range["max_cents"];
  if (typeof minCents !== "number" || typeof maxCents !== "number") return undefined;
  const currency = textOf(range["currency_type"]);
  return {
    min: minCents / 100,
    max: maxCents / 100,
    ...(currency ? { currency } : {}),
    period: "year",
  };
}

/**
 * Parses a Greenhouse job list into postings. Entries without a title or address are skipped.
 *
 * Example: a body with one job titled "Senior Backend Engineer" gives one posting with board
 * "greenhouse" and source name "greenhouse:examplecorp".
 * Failure: invalid JSON or a body without a `jobs` list throws `ScoutError("invalid-input")`.
 */
export function parseGreenhouse(body: string, token: string, now: Date): Posting[] {
  const boardName = `greenhouse:${token}`;
  const entries = readEntries(readJson(body, boardName), "jobs", boardName);
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) continue;
    const title = textOf(entry["title"]);
    const url = textOf(entry["absolute_url"]);
    if (title === undefined || url === undefined) continue;
    const location = isJsonObject(entry["location"])
      ? textOf(entry["location"]["name"])
      : undefined;
    const raw: RawPosting = {
      board: "greenhouse",
      sourceName: boardName,
      company: textOf(entry["company_name"]) ?? companyFromToken(token),
      title,
      location: location ?? "",
      url,
      descriptionHtml: textOf(entry["content"]) ?? "",
      postedAt: textOf(entry["first_published"]) ?? textOf(entry["updated_at"]),
      salary: readPayRange(entry),
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}
