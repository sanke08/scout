/**
 * Reads a Lever public postings list: `https://api.lever.co/v0/postings/{token}?mode=json`.
 *
 * The response is a list of `{ text, hostedUrl, categories: { location }, description,
 * lists: [{ text, content }], additional, createdAt, workplaceType, salaryRange }`.
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

/** Builds the address of a Lever company's postings list for a token. */
export function leverUrl(token: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
}

/** Joins the description, the titled lists (requirements and so on) and the closing text. */
function leverDescription(entry: JsonObject): string {
  const parts: string[] = [textOf(entry["description"]) ?? ""];
  const lists = entry["lists"];
  if (Array.isArray(lists)) {
    for (const list of lists) {
      if (!isJsonObject(list)) continue;
      parts.push(`<h3>${textOf(list["text"]) ?? ""}</h3><ul>${textOf(list["content"]) ?? ""}</ul>`);
    }
  }
  parts.push(textOf(entry["additional"]) ?? "");
  return parts.join("\n");
}

/** Reads Lever's optional structured pay range; "per-month-salary" means monthly, otherwise yearly. */
function readSalaryRange(entry: JsonObject): Salary | undefined {
  const range = entry["salaryRange"];
  if (!isJsonObject(range)) return undefined;
  const min = range["min"];
  const max = range["max"];
  if (typeof min !== "number" || typeof max !== "number") return undefined;
  const currency = textOf(range["currency"]);
  const period = String(range["interval"] ?? "").includes("month") ? "month" : "year";
  return { min, max, ...(currency ? { currency } : {}), period };
}

/** Reads the location text: the main category, or all listed locations joined. */
function leverLocation(entry: JsonObject): string {
  if (!isJsonObject(entry["categories"])) return "";
  const categories = entry["categories"];
  const location = textOf(categories["location"]);
  if (location !== undefined) return location;
  const all = categories["allLocations"];
  return Array.isArray(all) ? all.filter((item) => typeof item === "string").join("; ") : "";
}

/**
 * Parses a Lever postings list into postings. Entries without a title or address are skipped.
 *
 * Example: a body with one posting "Platform Engineer" gives one posting with board "lever".
 * Failure: invalid JSON or a body that is not a list throws `ScoutError("invalid-input")`.
 */
export function parseLever(body: string, token: string, now: Date): Posting[] {
  const boardName = `lever:${token}`;
  const entries = readEntries(readJson(body, boardName), undefined, boardName);
  const postings: Posting[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) continue;
    const title = textOf(entry["text"]);
    const url = textOf(entry["hostedUrl"]);
    if (title === undefined || url === undefined) continue;
    const createdAt = entry["createdAt"];
    const raw: RawPosting = {
      board: "lever",
      sourceName: boardName,
      company: companyFromToken(token),
      title,
      location: leverLocation(entry),
      url,
      descriptionHtml: leverDescription(entry),
      postedAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : undefined,
      workplaceHint: textOf(entry["workplaceType"]),
      salary: readSalaryRange(entry),
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}
