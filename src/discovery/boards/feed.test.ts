/** Properties of the RSS and Atom reader, checked against saved fictional feeds. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed } from "./feed.js";

const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved feed from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseFeed with RSS", () => {
  const postings = parseFeed(
    fixture("feed-remote-jobs.rss.xml"),
    "https://remote-jobs.example.com/rss.xml",
    NOW,
  );

  it("reads items, splitting 'Company: Title'", () => {
    expect(postings.map((posting) => [posting.company, posting.title])).toEqual([
      ["Examplecorp", "Senior Backend Engineer"],
      ["Northwind Labs", "Frontend Developer"],
      ["Quick Hire Ltd", "Data Entry Assistant"],
    ]);
    expect(postings[0]).toMatchObject({
      board: "feed",
      canonicalUrl: "https://remote-jobs.example.com/jobs/senior-backend-engineer-examplecorp",
      postedAt: "2026-10-02T09:00:00.000Z",
    });
    expect(postings[0]?.sources[0]?.name).toBe("feed:remote-jobs.example.com");
    expect(postings[1]?.remote).toBe("remote");
  });

  it("flags the scam-looking item and no other", () => {
    expect(postings[2]?.flags).toContain("scam-suspect");
    expect(postings[0]?.flags).not.toContain("scam-suspect");
    expect(postings[1]?.flags).not.toContain("scam-suspect");
  });
});

describe("parseFeed with Atom", () => {
  const postings = parseFeed(
    fixture("feed-atom-jobs.xml"),
    "https://tech-hiring.example.net/feed",
    NOW,
  );

  it("reads entries, splitting 'Title at Company' and using the alternate link", () => {
    expect(postings.map((posting) => [posting.company, posting.title])).toEqual([
      ["Examplecorp", "Sr. Backend Engineer"],
      ["Northwind Labs", "Platform Engineer"],
    ]);
    expect(postings[0]?.canonicalUrl).toBe("https://tech-hiring.example.net/posts/4821");
    expect(postings[0]?.seniority).toBe("senior");
  });
});

describe("parseFeed errors", () => {
  it("rejects text that is not well-formed XML and XML that is not a feed", () => {
    expect(() => parseFeed("<rss><channel>", "https://feeds.example.com/a", NOW)).toThrow(
      /feed:feeds.example.com feed is not well-formed XML/,
    );
    expect(() =>
      parseFeed("<html><body>hi</body></html>", "https://feeds.example.com/a", NOW),
    ).toThrow(/neither RSS nor Atom/);
  });

  it("reads an empty feed as no postings", () => {
    const empty = '<rss version="2.0"><channel><title>Empty</title></channel></rss>';
    expect(parseFeed(empty, "https://feeds.example.com/a", NOW)).toEqual([]);
  });
});
