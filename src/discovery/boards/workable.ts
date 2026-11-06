/**
 * Reads a Workable public widget feed: `https://apply.workable.com/api/v1/widget/accounts/{token}?details=true`.
 *
 * The response is `{ "name": "...", "jobs": [ { title, city, state, country, telecommuting,
 * published_on, url, description } ] }`.
 */
import type { Posting } from "../../shared/index.js";
import { buildPosting, type RawPosting } from "../normalise.js";
import {
  companyFromToken,
  isJsonObject,
  readEntries,
  readJson,
  textOf,
  type JsonObject,
} from "../parse-helpers.js";

/** Builds the address of a Workable account's job feed for a token. */
export function workableUrl(token: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`;
}

/** Joins city, state and country into one location text, leaving out missing parts. */
function workableLocation(entry: JsonObject): string {
  const parts = [entry["city"], entry["state"], entry["country"]].map(textOf);
  return parts.filter((part) => part !== undefined).join(", ");
}

/**
 * Parses a Workable job feed into postings. Entries without a title or address are skipped.
 *
 * Example: a job with `telecommuting: true` gives remote "remote".
 * Failure: invalid JSON or a body without a `jobs` list throws `ScoutError("invalid-input")`.
 */
export function parseWorkable(body: string, token: string, now: Date): Posting[] {
  const boardName = `workable:${token}`;
  const parsed = readJson(body, boardName);
  const entries = readEntries(parsed, "jobs", boardName);
  const companyName = isJsonObject(parsed) ? textOf(parsed["name"]) : undefined;
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) continue;
    const title = textOf(entry["title"]);
    const url = textOf(entry["url"]) ?? textOf(entry["shortlink"]);
    if (title === undefined || url === undefined) continue;
    const raw: RawPosting = {
      board: "workable",
      sourceName: boardName,
      company: companyName ?? companyFromToken(token),
      title,
      location: workableLocation(entry),
      url,
      descriptionHtml: textOf(entry["description"]) ?? "",
      postedAt: textOf(entry["published_on"]) ?? textOf(entry["created_at"]),
      workplaceHint: entry["telecommuting"] === true ? "remote" : undefined,
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}
