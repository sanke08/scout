/**
 * Reads a SmartRecruiters public postings list: `https://api.smartrecruiters.com/v1/companies/{token}/postings`.
 *
 * The list holds `{ content: [ { id, name, company: { name }, releasedDate, location: { fullLocation,
 * remote } } ] }` but no job text. The text comes from one more request per job, to
 * `.../postings/{id}`, whose `jobAd.sections` hold the description. `parseSmartRecruiters` takes
 * the list plus those texts, already fetched, so this file does no network work.
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

/** Builds the address of a company's postings list for a token (the company identifier). */
export function smartRecruitersUrl(token: string): string {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;
}

/** Builds the address of one posting's detail, which holds the job text. */
export function smartRecruitersDetailUrl(token: string, postingId: string): string {
  return `${smartRecruitersUrl(token)}/${encodeURIComponent(postingId)}`;
}

/**
 * Returns the ids of the postings in a list, so the caller can fetch each one's text.
 * Failure: invalid JSON or a body without a `content` list throws `ScoutError("invalid-input")`.
 */
export function readSmartRecruitersIds(listBody: string, token: string): string[] {
  const boardName = `smartrecruiters:${token}`;
  const entries = readEntries(readJson(listBody, boardName), "content", boardName);
  const ids: string[] = [];
  for (const entry of entries) {
    const id = isJsonObject(entry) ? textOf(entry["id"]) : undefined;
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * Joins the sections of one posting's detail (company, job, qualifications, extra information)
 * into one HTML text.
 * Failure: invalid JSON throws `ScoutError("invalid-input")`; a detail with no sections gives "".
 */
export function readSmartRecruitersDescription(detailBody: string, token: string): string {
  const detail = readJson(detailBody, `smartrecruiters:${token}`);
  if (!isJsonObject(detail) || !isJsonObject(detail["jobAd"])) return "";
  const sections = detail["jobAd"]["sections"];
  if (!isJsonObject(sections)) return "";
  const parts: string[] = [];
  for (const section of Object.values(sections)) {
    if (!isJsonObject(section)) continue;
    parts.push(`<h3>${textOf(section["title"]) ?? ""}</h3>${textOf(section["text"]) ?? ""}`);
  }
  return parts.join("\n");
}

/** Reads the location text from a posting's `location` object. */
function smartRecruitersLocation(location: JsonObject | undefined): string {
  if (location === undefined) return "";
  const full = textOf(location["fullLocation"]);
  if (full !== undefined) return full;
  const parts = [location["city"], location["region"], location["country"]].map(textOf);
  return parts.filter((part) => part !== undefined).join(", ");
}

/**
 * Parses a postings list into postings. `descriptions` maps each posting id to its HTML text; an
 * id with no entry gets an empty description. Entries without an id or name are skipped.
 *
 * Example: a list with one posting `{ id: "7440001", name: "Data Engineer" }` and
 * `descriptions` of `{ "7440001": "<p>Build pipelines</p>" }` gives one posting whose address is
 * `https://jobs.smartrecruiters.com/{token}/7440001`.
 * Failure: invalid JSON or a body without a `content` list throws `ScoutError("invalid-input")`.
 */
export function parseSmartRecruiters(
  listBody: string,
  token: string,
  now: Date,
  descriptions: ReadonlyMap<string, string>,
): Posting[] {
  const boardName = `smartrecruiters:${token}`;
  const entries = readEntries(readJson(listBody, boardName), "content", boardName);
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) continue;
    const id = textOf(entry["id"]);
    const title = textOf(entry["name"]);
    if (id === undefined || title === undefined) continue;
    const location = isJsonObject(entry["location"]) ? entry["location"] : undefined;
    const company = isJsonObject(entry["company"]) ? textOf(entry["company"]["name"]) : undefined;
    const raw: RawPosting = {
      board: "smartrecruiters",
      sourceName: boardName,
      company: company ?? companyFromToken(token),
      title,
      location: smartRecruitersLocation(location),
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(id)}`,
      descriptionHtml: descriptions.get(id) ?? "",
      postedAt: textOf(entry["releasedDate"]),
      workplaceHint: location?.["remote"] === true ? "remote" : undefined,
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}
