/**
 * Works out which job board software a company's careers address belongs to.
 *
 * Scout keeps a list of target companies; this lets the owner paste a careers link and get the
 * board kind and token that `Discovery.fetchBoard` needs.
 */
import type { Posting } from "../shared/index.js";

/** A board kind and the token that names the company on it. */
export interface DetectedBoard {
  kind: Posting["board"];
  token: string;
}

/** Subdomains that are never a company name. */
const GENERIC_SUBDOMAINS = new Set(["www", "careers", "jobs", "apply", "app", "api", "boards"]);

/** Returns the first path segment of a URL, or undefined. */
function firstSegment(url: URL): string | undefined {
  return url.pathname.split("/").find((segment) => segment !== "");
}

/** Returns the path segment that follows `marker`, for addresses like `/v1/boards/{token}/jobs`. */
function segmentAfter(url: URL, marker: string): string | undefined {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const position = segments.indexOf(marker);
  return position === -1 ? undefined : segments[position + 1];
}

/** Returns the left-most label of a host when the host ends with `suffix`: `acme.recruitee.com` gives "acme". */
function subdomainOf(host: string, suffix: string): string | undefined {
  if (!host.endsWith(`.${suffix}`)) return undefined;
  const label = host.slice(0, -(suffix.length + 1));
  return label.includes(".") || GENERIC_SUBDOMAINS.has(label) ? undefined : label;
}

/** True when the path looks like an RSS or Atom feed. */
function looksLikeFeed(url: URL): boolean {
  return /\.(rss|atom|xml)$/i.test(url.pathname) || /\/(feed|rss|atom)\/?$/i.test(url.pathname);
}

/**
 * Detects the board from a careers address; returns undefined when it is not a known board.
 *
 * Examples:
 * - `https://boards.greenhouse.io/examplecorp/jobs/123` gives `{ kind: "greenhouse", token: "examplecorp" }`
 * - `https://jobs.lever.co/examplecorp` gives `{ kind: "lever", token: "examplecorp" }`
 * - `https://jobs.ashbyhq.com/examplecorp` gives `{ kind: "ashby", token: "examplecorp" }`
 * - `https://acme.recruitee.com/` gives `{ kind: "recruitee", token: "acme" }`
 * - `https://example.com/jobs.rss` gives `{ kind: "feed", token: "https://example.com/jobs.rss" }`
 * - `https://example.com/careers` gives undefined
 */
export function detectBoard(careersUrl: string): DetectedBoard | undefined {
  const text = careersUrl.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const token = url.searchParams.get("for") ?? firstSegment(url);
    return token && token !== "embed" ? { kind: "greenhouse", token } : undefined;
  }
  if (host === "boards-api.greenhouse.io") {
    const token = segmentAfter(url, "boards");
    return token ? { kind: "greenhouse", token } : undefined;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const token = firstSegment(url);
    return token ? { kind: "lever", token } : undefined;
  }
  if (host === "api.lever.co") {
    const token = segmentAfter(url, "postings");
    return token ? { kind: "lever", token } : undefined;
  }
  if (host === "jobs.ashbyhq.com") {
    const token = firstSegment(url);
    return token ? { kind: "ashby", token } : undefined;
  }
  if (host === "api.ashbyhq.com") {
    const token = segmentAfter(url, "job-board");
    return token ? { kind: "ashby", token } : undefined;
  }
  if (host === "apply.workable.com") {
    const token = segmentAfter(url, "accounts") ?? firstSegment(url);
    return token && token !== "api" ? { kind: "workable", token } : undefined;
  }
  const workableToken = subdomainOf(host, "workable.com");
  if (workableToken) return { kind: "workable", token: workableToken };
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    const token = firstSegment(url);
    return token ? { kind: "smartrecruiters", token } : undefined;
  }
  const recruiteeToken = subdomainOf(host, "recruitee.com");
  if (recruiteeToken) return { kind: "recruitee", token: recruiteeToken };
  if (looksLikeFeed(url)) return { kind: "feed", token: url.toString() };
  return undefined;
}
