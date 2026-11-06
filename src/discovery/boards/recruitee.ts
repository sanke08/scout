/**
 * Reads a Recruitee public offers list: `https://{token}.recruitee.com/api/offers/`.
 *
 * The response is `{ "offers": [ { title, description, requirements, location, remote,
 * careers_url, published_at, company_name } ] }`.
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

/** Builds the address of a Recruitee company's offers list for a token (the company's subdomain). */
export function recruiteeUrl(token: string): string {
  return `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`;
}

/**
 * Parses a Recruitee offers list into postings. Offers whose status is not "published" and
 * entries without a title or address are skipped.
 *
 * Example: an offer with `remote: true` gives remote "remote".
 * Failure: invalid JSON or a body without an `offers` list throws `ScoutError("invalid-input")`.
 */
export function parseRecruitee(body: string, token: string, now: Date): Posting[] {
  const boardName = `recruitee:${token}`;
  const entries = readEntries(readJson(body, boardName), "offers", boardName);
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) continue;
    const status = textOf(entry["status"]);
    if (status !== undefined && status !== "published") continue;
    const title = textOf(entry["title"]);
    const url = textOf(entry["careers_url"]);
    if (title === undefined || url === undefined) continue;
    const raw: RawPosting = {
      board: "recruitee",
      sourceName: boardName,
      company: textOf(entry["company_name"]) ?? companyFromToken(token),
      title,
      location: recruiteeLocation(entry),
      url,
      descriptionHtml: `${textOf(entry["description"]) ?? ""}\n${textOf(entry["requirements"]) ?? ""}`,
      postedAt: textOf(entry["published_at"]) ?? textOf(entry["created_at"]),
      workplaceHint: entry["remote"] === true ? "remote" : undefined,
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}

/** Reads the offer's location text, falling back to city and country. */
function recruiteeLocation(entry: JsonObject): string {
  const location = textOf(entry["location"]);
  if (location !== undefined) return location;
  return [textOf(entry["city"]), textOf(entry["country"])]
    .filter((part) => part !== undefined)
    .join(", ");
}
