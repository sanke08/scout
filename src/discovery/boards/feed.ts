/**
 * Reads an RSS or Atom feed of jobs (an aggregator, a community "who is hiring" feed).
 *
 * Feeds are tier C sources: wide but noisy. Items carry a title, a link, a date and a text. The
 * company is taken from an explicit company or author field, else from a title written as
 * "Company: Job title" or "Job title at Company", else from the feed's own title.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ScoutError, type Posting } from "../../shared/index.js";
import { buildPosting, type RawPosting } from "../normalise.js";
import { isJsonObject, textOf, type JsonObject } from "../parse-helpers.js";

/** Reads feeds without turning anything into code; every value stays plain text. */
const FEED_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  processEntities: true,
});

/** Wraps a single value in a list, passes a list through, and turns "missing" into an empty list. */
function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Returns the text of an XML value that is plain text, or text plus attributes. */
function xmlText(value: unknown): string | undefined {
  if (typeof value === "string") return textOf(value);
  if (isJsonObject(value)) return textOf(value["#text"]);
  return undefined;
}

/** Returns the address of an Atom entry's link (the alternate link, or the first one). */
function atomLink(value: unknown): string | undefined {
  const links = asList(value).filter(isJsonObject);
  const alternate = links.find(
    (link) => link["@_rel"] === undefined || link["@_rel"] === "alternate",
  );
  const chosen = alternate ?? links[0];
  return chosen ? textOf(chosen["@_href"]) : undefined;
}

/** What the feed itself says about one item, before company and normalising. */
interface FeedItem {
  title: string;
  url: string;
  text: string;
  postedAt: string | undefined;
  company: string | undefined;
}

/** Reads one RSS `<item>`. */
function readRssItem(item: JsonObject): FeedItem | undefined {
  const title = xmlText(item["title"]);
  const url = xmlText(item["link"]) ?? xmlText(item["guid"]);
  if (title === undefined || url === undefined) return undefined;
  return {
    title,
    url,
    text: xmlText(item["content:encoded"]) ?? xmlText(item["description"]) ?? "",
    postedAt: xmlText(item["pubDate"]) ?? xmlText(item["dc:date"]),
    company: xmlText(item["company"]) ?? xmlText(item["dc:creator"]) ?? xmlText(item["author"]),
  };
}

/** Reads one Atom `<entry>`. */
function readAtomEntry(entry: JsonObject): FeedItem | undefined {
  const title = xmlText(entry["title"]);
  const url = atomLink(entry["link"]);
  if (title === undefined || url === undefined) return undefined;
  const author = isJsonObject(entry["author"]) ? xmlText(entry["author"]["name"]) : undefined;
  return {
    title,
    url,
    text: xmlText(entry["content"]) ?? xmlText(entry["summary"]) ?? "",
    postedAt: xmlText(entry["published"]) ?? xmlText(entry["updated"]),
    company: author,
  };
}

/**
 * Splits a combined title into company and job title.
 * Examples: "Examplecorp: Platform Engineer" gives company "Examplecorp";
 * "Platform Engineer at Examplecorp" gives company "Examplecorp"; anything else has no company.
 */
function splitTitle(combined: string): { company?: string; title: string } {
  const colon = /^([^:]{2,60}):\s+(.+)$/.exec(combined);
  if (colon?.[1] !== undefined && colon[2] !== undefined) {
    return { company: colon[1].trim(), title: colon[2].trim() };
  }
  const at = /^(.+?)\s+at\s+([^,|]{2,60})$/i.exec(combined);
  if (at?.[1] !== undefined && at[2] !== undefined) {
    return { company: at[2].trim(), title: at[1].trim() };
  }
  return { title: combined };
}

/** Reads the host of a feed address, used to name the source: "https://jobs.example.com/rss" gives "jobs.example.com". */
export function feedHost(feedUrl: string): string {
  try {
    return new URL(feedUrl).host;
  } catch {
    return feedUrl;
  }
}

/**
 * Parses an RSS 2.0 or Atom feed into postings. Items without a title or link are skipped.
 *
 * Example: an RSS item titled "Examplecorp: Platform Engineer" with a link gives one posting
 * with company "Examplecorp", title "Platform Engineer", board "feed" and source name
 * "feed:jobs.example.com".
 * Failure: text that is not well-formed XML, or that is neither RSS nor Atom, throws
 * `ScoutError("invalid-input")` naming the feed.
 */
export function parseFeed(body: string, feedUrl: string, now: Date): Posting[] {
  const sourceName = `feed:${feedHost(feedUrl)}`;
  if (XMLValidator.validate(body) !== true) {
    throw new ScoutError(
      "invalid-input",
      `The ${sourceName} feed is not well-formed XML, so nothing was read from it.`,
    );
  }
  const document = FEED_PARSER.parse(body) as JsonObject;
  const channel = isJsonObject(document["rss"]) ? document["rss"]["channel"] : undefined;
  const atomFeed = isJsonObject(document["feed"]) ? document["feed"] : undefined;
  let items: FeedItem[];
  let feedTitle: string | undefined;
  if (isJsonObject(channel)) {
    feedTitle = xmlText(channel["title"]);
    items = asList(channel["item"]).filter(isJsonObject).map(readRssItem).filter(isDefined);
  } else if (atomFeed) {
    feedTitle = xmlText(atomFeed["title"]);
    items = asList(atomFeed["entry"]).filter(isJsonObject).map(readAtomEntry).filter(isDefined);
  } else {
    throw new ScoutError(
      "invalid-input",
      `The ${sourceName} feed is neither RSS nor Atom, so nothing was read from it.`,
    );
  }
  const postings: Posting[] = [];
  for (const item of items) {
    const split = item.company === undefined ? splitTitle(item.title) : { title: item.title };
    const raw: RawPosting = {
      board: "feed",
      sourceName,
      company: item.company ?? split.company ?? feedTitle ?? feedHost(feedUrl),
      title: split.title,
      location: "",
      url: item.url,
      descriptionHtml: item.text,
      postedAt: item.postedAt,
    };
    postings.push(buildPosting(raw, now));
  }
  return postings;
}

/** True when a value is not undefined; lets a list of maybe-items become a list of items. */
function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}
