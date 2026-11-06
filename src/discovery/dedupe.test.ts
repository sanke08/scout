/** Properties of layered dedupe: same job merges, different jobs stay apart, official board wins. */
import { describe, expect, it } from "vitest";
import type { Posting } from "../shared/index.js";
import { dedupePostings, descriptionSimilarity } from "./dedupe.js";

const LONG_TEXT =
  "We build booking software for clinics and need an engineer who designs services in Node.js, models data in PostgreSQL, runs workloads on Kubernetes and mentors colleagues. You bring five years of backend experience and write clearly. The team reviews every change together and shares on-call fairly.";

/** Builds a posting; tests override the fields that matter for the case. */
function posting(overrides: Partial<Posting> & { url: string }): Posting {
  const { url, ...rest } = overrides;
  return {
    id: url.slice(-8),
    company: "Examplecorp",
    title: "Senior Backend Engineer",
    location: "Berlin",
    remote: "unknown",
    seniority: "senior",
    skills: [],
    description: LONG_TEXT,
    firstSeenAt: "2026-11-07T09:00:00.000Z",
    lastSeenAt: "2026-11-07T09:00:00.000Z",
    sources: [{ name: `source:${url}`, url }],
    canonicalUrl: url,
    board: "feed",
    flags: [],
    ...rest,
  };
}

describe("dedupePostings", () => {
  it("merges identical canonical addresses (layer 1)", () => {
    const merged = dedupePostings([
      posting({
        url: "https://a.example.com/1",
        title: "One",
        company: "A",
        sources: [{ name: "first", url: "https://a.example.com/1" }],
      }),
      posting({
        url: "https://a.example.com/1",
        title: "Other title",
        company: "B",
        description: "x",
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toHaveLength(2);
  });

  it("merges the same company, title and location written slightly differently (layer 2)", () => {
    const merged = dedupePostings([
      posting({
        url: "https://a.example.com/1",
        company: "Examplecorp Inc.",
        location: "Berlin, Germany",
        description: "short",
      }),
      posting({
        url: "https://b.example.com/2",
        company: "examplecorp",
        title: "senior backend engineer",
        location: "Berlin",
        description: "different words",
      }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("merges similar descriptions with a similar title but different locations (layer 3)", () => {
    const merged = dedupePostings([
      posting({ url: "https://a.example.com/1", location: "Berlin" }),
      posting({
        url: "https://b.example.com/2",
        title: "Sr. Backend Engineer",
        location: "Germany",
        description: `${LONG_TEXT} Posted by Examplecorp.`,
      }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("keeps different jobs apart, even at one company with similar boilerplate", () => {
    const boilerplate = `${LONG_TEXT} `;
    const merged = dedupePostings([
      posting({
        url: "https://a.example.com/1",
        title: "Backend Engineer",
        location: "Berlin",
        description: boilerplate,
      }),
      posting({
        url: "https://a.example.com/2",
        title: "Product Designer",
        location: "Paris",
        description: boilerplate,
      }),
      posting({
        url: "https://a.example.com/3",
        title: "Backend Engineer",
        location: "Paris",
        company: "Otherco",
        description: "Completely unrelated text about accounting duties. ".repeat(8),
      }),
    ]);
    expect(merged).toHaveLength(3);
  });

  it("turns one job on five sources into one posting with five sources, official board canonical", () => {
    const merged = dedupePostings([
      posting({ url: "https://feed-one.example.com/j/1", board: "feed" }),
      posting({
        url: "https://mirror.example.org/copy/1",
        board: "feed",
        location: "Berlin, Germany",
      }),
      posting({
        url: "https://boards.greenhouse.io/examplecorp/jobs/1",
        board: "greenhouse",
        id: "greenhouse-id",
      }),
      posting({
        url: "https://feed-two.example.com/j/2",
        board: "feed",
        title: "Sr. Backend Engineer",
      }),
      posting({ url: "https://other.example.com/j/3", board: "other" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toHaveLength(5);
    expect(merged[0]?.board).toBe("greenhouse");
    expect(merged[0]?.canonicalUrl).toBe("https://boards.greenhouse.io/examplecorp/jobs/1");
    expect(merged[0]?.id).toBe("greenhouse-id");
  });

  it("prefers the first official board when several official boards carry the job", () => {
    const merged = dedupePostings([
      posting({ url: "https://feed.example.com/1", board: "feed" }),
      posting({ url: "https://jobs.lever.co/examplecorp/1", board: "lever" }),
      posting({ url: "https://boards.greenhouse.io/examplecorp/jobs/1", board: "greenhouse" }),
    ]);
    expect(merged[0]?.board).toBe("lever");
    expect(merged[0]?.sources).toHaveLength(3);
  });

  it("keeps the earliest first-seen and posted dates and the latest last-seen", () => {
    const merged = dedupePostings([
      posting({
        url: "https://a.example.com/1",
        firstSeenAt: "2026-11-05T00:00:00.000Z",
        lastSeenAt: "2026-11-06T00:00:00.000Z",
        postedAt: "2026-10-03T00:00:00.000Z",
      }),
      posting({
        url: "https://b.example.com/2",
        firstSeenAt: "2026-11-01T00:00:00.000Z",
        lastSeenAt: "2026-11-07T00:00:00.000Z",
        postedAt: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    expect(merged[0]).toMatchObject({
      firstSeenAt: "2026-11-01T00:00:00.000Z",
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      postedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("keeps scam flags from any copy but not ghost flags from a non-canonical copy", () => {
    const merged = dedupePostings([
      posting({ url: "https://boards.greenhouse.io/examplecorp/jobs/1", board: "greenhouse" }),
      posting({ url: "https://feed.example.com/1", flags: ["scam-suspect", "ghost-suspect"] }),
    ]);
    expect(merged[0]?.flags).toEqual(["scam-suspect"]);
  });

  it("is deterministic and does not change its input", () => {
    const input = [
      posting({ url: "https://a.example.com/1" }),
      posting({ url: "https://b.example.com/2" }),
    ];
    const before = JSON.stringify(input);
    expect(JSON.stringify(dedupePostings(input))).toBe(JSON.stringify(dedupePostings(input)));
    expect(JSON.stringify(input)).toBe(before);
    expect(dedupePostings([])).toEqual([]);
  });
});

describe("descriptionSimilarity", () => {
  it("is 1 for identical text and near 0 for unrelated text", () => {
    expect(descriptionSimilarity(LONG_TEXT, LONG_TEXT)).toBe(1);
    expect(
      descriptionSimilarity(
        LONG_TEXT,
        "Completely different words about baking bread every single morning",
      ),
    ).toBeLessThan(0.1);
  });
});
