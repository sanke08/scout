/**
 * Reads an Ashby public job board: `https://api.ashbyhq.com/posting-api/job-board/{token}`.
 *
 * The response is `{ "jobs": [ { title, location, isRemote, workplaceType, publishedAt,
 * jobUrl, descriptionHtml, isListed } ] }`.
 */
import type { Posting } from "../../shared/index.js";
import { buildPosting, type RawPosting } from "../normalise.js";
import { companyFromToken, isJsonObject, readEntries, readJson, textOf } from "../parse-helpers.js";

/** Builds the address of an Ashby job board for a token. */
export function ashbyUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
}

/**
 * Parses an Ashby job board into postings. Jobs marked `isListed: false` and entries without a
 * title or address are skipped.
 *
 * Example: a job with `workplaceType: "Remote"` gives remote "remote".
 * Failure: invalid JSON or a body without a `jobs` list throws `ScoutError("invalid-input")`.
 */
export function parseAshby(body: string, token: string, now: Date): Posting[] {
  const boardName = `ashby:${token}`;
  const entries = readEntries(readJson(body, boardName), "jobs", boardName);
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry) || entry["isListed"] === false) continue;
    const title = textOf(entry["title"]);
    const url = textOf(entry["jobUrl"]);
    if (title === undefined || url === undefined) continue;
    const raw: RawPosting = {
      board: "ashby",
      sourceName: boardName,
      company: companyFromToken(token),
      title,
      location: textOf(entry["location"]) ?? "",
      url,
      descriptionHtml: textOf(entry["descriptionHtml"]) ?? textOf(entry["descriptionPlain"]) ?? "",
      postedAt: textOf(entry["publishedAt"]),
      workplaceHint:
        textOf(entry["workplaceType"]) ?? (entry["isRemote"] === true ? "remote" : undefined),
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}
