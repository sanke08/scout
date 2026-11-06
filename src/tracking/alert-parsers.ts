/**
 * Reads job-alert emails from the big job platforms and lists the jobs in them.
 *
 * Why it exists: those platforms are used for discovery only by email alert (idea 5.4, Tier D and
 * 5.14). Scout never opens, searches or scrapes them. It reads the text of the alert the user
 * already receives and pulls out each job: title, company, location and the link.
 *
 * The formats here are MODELLED on typical alert digests, not copied from real emails, and the
 * real ones change without notice. A digest that does not look like the model gives an empty
 * list, never a wrong job. Email text is untrusted: titles and companies are only trimmed and
 * length-capped, and links must start with http or https.
 *
 * Example: `parseAlertEmail(message)` for a LinkedIn digest gives
 * `[{ title: "Backend Engineer", company: "Northwind Labs", location: "Berlin, Germany",
 *    url: "https://www.linkedin.example.com/comm/jobs/view/1000000001", platform: "linkedin" }]`.
 */
import { senderDomain } from "./parse-message.js";
import type { ParsedMessage } from "./message-types.js";

/** The platforms whose alert emails Scout can read. */
export const ALERT_PLATFORMS = ["linkedin", "indeed", "naukri"] as const;

/** One platform name, for example `"indeed"`. */
export type AlertPlatform = (typeof ALERT_PLATFORMS)[number];

/** A job as listed in an alert: only what the email says, with no description and no id. */
export interface PartialPosting {
  title: string;
  company: string;
  location: string;
  /** The platform's link for this job, exactly as in the email. Scout opens it only if the user asks. */
  url: string;
  platform: AlertPlatform;
}

/** The most jobs read from one email. A digest longer than this is cut. */
export const MAX_JOBS_PER_ALERT = 50;

/** The longest title, company or location kept. */
const MAX_FIELD_CHARACTERS = 200;

/** Finds the first web address in a line. Angle brackets and trailing punctuation are not part of it. */
const ADDRESS_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** Per platform: the part of a job link that tells a job link from a search or unsubscribe link. */
const JOB_LINK_MARKER: Record<AlertPlatform, string> = {
  linkedin: "/jobs/view/",
  indeed: "/viewjob",
  naukri: "/job-listings",
};

/**
 * Works out which platform sent an alert from the sender's domain: a domain with a label that
 * equals the platform name ("linkedin.com", "mail.indeed.com"). Returns undefined for any other
 * sender, so ordinary mail is never parsed as an alert.
 */
export function detectAlertPlatform(message: ParsedMessage): AlertPlatform | undefined {
  const labels = senderDomain(message).split(".");
  return ALERT_PLATFORMS.find((platform) => labels.includes(platform));
}

/** Trims a field and caps its length. */
function cleanField(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARACTERS);
}

/** Returns the web address in `line`, without trailing punctuation, or undefined. */
function addressIn(line: string): string | undefined {
  const found = ADDRESS_PATTERN.exec(line);
  return found === null ? undefined : found[0].replace(/[.,;:!?)]+$/, "");
}

/** Builds a posting when every field is present; otherwise undefined. */
function toPosting(
  platform: AlertPlatform,
  title: string,
  company: string,
  location: string,
  url: string | undefined,
): PartialPosting | undefined {
  const cleanTitle = cleanField(title);
  const cleanCompany = cleanField(company);
  if (cleanTitle === "" || cleanCompany === "" || url === undefined) return undefined;
  return {
    title: cleanTitle,
    company: cleanCompany,
    location: cleanField(location),
    url,
    platform,
  };
}

/**
 * LinkedIn digest: three lines per job: the title, "Company · Location", "View job: link".
 * The job is found from its link line; the two lines above it are read.
 */
function parseLinkedIn(lines: string[]): PartialPosting[] {
  const postings: PartialPosting[] = [];
  lines.forEach((line, index) => {
    const url = addressIn(line);
    if (url === undefined || !url.includes(JOB_LINK_MARKER.linkedin)) return;
    const detail = lines[index - 1] ?? "";
    const separator = detail.indexOf("·");
    if (separator === -1) return;
    const posting = toPosting(
      "linkedin",
      lines[index - 2] ?? "",
      detail.slice(0, separator),
      detail.slice(separator + 1),
      url,
    );
    if (posting !== undefined) postings.push(posting);
  });
  return postings;
}

/**
 * Indeed digest: three lines per job: the title, "Company - Location", then the link alone.
 * The last " - " splits company from location, because company names can contain a hyphen more
 * often than a location does.
 */
function parseIndeed(lines: string[]): PartialPosting[] {
  const postings: PartialPosting[] = [];
  lines.forEach((line, index) => {
    const url = addressIn(line);
    if (url === undefined || !url.includes(JOB_LINK_MARKER.indeed)) return;
    const detail = lines[index - 1] ?? "";
    const separator = detail.lastIndexOf(" - ");
    if (separator === -1) return;
    const posting = toPosting(
      "indeed",
      lines[index - 2] ?? "",
      detail.slice(0, separator),
      detail.slice(separator + 3),
      url,
    );
    if (posting !== undefined) postings.push(posting);
  });
  return postings;
}

/**
 * Naukri digest (HTML): per job, a line with the title and its link, then the company, then
 * "Location | experience | salary". Only the location part is kept.
 */
function parseNaukri(lines: string[]): PartialPosting[] {
  const postings: PartialPosting[] = [];
  lines.forEach((line, index) => {
    const url = addressIn(line);
    if (url === undefined || !url.includes(JOB_LINK_MARKER.naukri)) return;
    const title = line.slice(0, line.indexOf(url)).replace(/<$/, "");
    const location = (lines[index + 2] ?? "").split("|")[0] ?? "";
    const posting = toPosting("naukri", title, lines[index + 1] ?? "", location, url);
    if (posting !== undefined) postings.push(posting);
  });
  return postings;
}

/**
 * Lists the jobs in a platform alert email, at most `MAX_JOBS_PER_ALERT`.
 *
 * Returns an empty list when the sender is not a known platform or the text does not look like
 * the modelled digest. Duplicate links in one digest are listed once.
 * Nothing is fetched: only the email's own text is used.
 */
export function parseAlertEmail(message: ParsedMessage): PartialPosting[] {
  const platform = detectAlertPlatform(message);
  if (platform === undefined) return [];
  const lines = message.text.split("\n").map((line) => line.trim());
  const parsers: Record<AlertPlatform, (lines: string[]) => PartialPosting[]> = {
    linkedin: parseLinkedIn,
    indeed: parseIndeed,
    naukri: parseNaukri,
  };
  const seen = new Set<string>();
  const unique: PartialPosting[] = [];
  for (const posting of parsers[platform](lines)) {
    if (seen.has(posting.url)) continue;
    seen.add(posting.url);
    unique.push(posting);
  }
  return unique.slice(0, MAX_JOBS_PER_ALERT);
}
