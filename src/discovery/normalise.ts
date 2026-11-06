/**
 * Turns the raw facts a board parser read into one normalised `Posting`.
 *
 * Every board parser fills a `RawPosting` and calls `buildPosting`, so the stable id, remote
 * type, seniority, salary, skills and flags are worked out in exactly one place.
 */
import type { BoardKind, Posting } from "../shared/index.js";
import { canonicalizeUrl, postingIdFromUrl } from "./canonical-url.js";
import { detectRemote, detectSeniority } from "./classify.js";
import { withDetectedFlags } from "./flags.js";
import { htmlToText } from "./html-text.js";
import { extractSalary, type Salary } from "./salary.js";
import { extractSkills } from "./skills.js";

/** What a board parser knows about one posting before normalising. */
export interface RawPosting {
  /** Which kind of board it came from, for example "greenhouse". */
  board: BoardKind;
  /** Name of the source, for example "greenhouse:examplecorp". */
  sourceName: string;
  company: string;
  title: string;
  /** Location as the board writes it; may be empty. */
  location: string;
  /** The job's own address, with or without tracking parameters. */
  url: string;
  /** Description as the board sent it: HTML or plain text. */
  descriptionHtml: string;
  /** ISO timestamp or other date text from the board, when given. */
  postedAt?: string | undefined;
  /** The board's own remote hint such as "remote" or "on-site", when it gives one. */
  workplaceHint?: string | undefined;
  /** Pay range the board gives as structured data, when it does. */
  salary?: Salary | undefined;
}

/** Returns an ISO timestamp for a date text, or undefined when it cannot be read. */
export function toIsoDate(text: string | number | undefined): string | undefined {
  if (text === undefined || text === "") return undefined;
  const milliseconds = typeof text === "number" ? text : Date.parse(text);
  if (Number.isNaN(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString();
}

/**
 * Builds the normalised posting. First and last seen are both `now`; the caller merges them
 * with earlier sightings.
 *
 * Example: a raw posting titled "Senior Backend Engineer" at
 * `https://boards.example.com/jobs/1?utm_source=x` gives seniority "senior", the id of the
 * address without `utm_source`, and the description as plain text.
 * Failure: an invalid job address throws `ScoutError("invalid-input")`.
 */
export function buildPosting(raw: RawPosting, now: Date): Posting {
  const canonicalUrl = canonicalizeUrl(raw.url);
  const description = htmlToText(raw.descriptionHtml);
  const location = raw.location.trim();
  const timestamp = now.toISOString();
  const salary = raw.salary ?? extractSalary(description);
  const postedAt = toIsoDate(raw.postedAt);
  const posting: Posting = {
    id: postingIdFromUrl(raw.url),
    company: raw.company.trim(),
    title: raw.title.trim(),
    location,
    remote: detectRemote(location, raw.title, description, raw.workplaceHint),
    ...(salary ? { salary } : {}),
    seniority: detectSeniority(raw.title),
    skills: extractSkills(`${raw.title}\n${description}`),
    description,
    ...(postedAt ? { postedAt } : {}),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    sources: [{ name: raw.sourceName, url: canonicalUrl }],
    canonicalUrl,
    board: raw.board,
    flags: [],
  };
  return withDetectedFlags(posting, now);
}
