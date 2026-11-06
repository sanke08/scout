/** Properties of freshness: closed postings and reposts. */
import { describe, expect, it } from "vitest";
import type { Posting } from "../shared/index.js";
import { closedSince, markReposts } from "./freshness.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Builds a healthy posting for a job address; tests override fields. */
function posting(url: string, overrides: Partial<Posting> = {}): Posting {
  return {
    id: url.slice(-6),
    company: "Examplecorp",
    title: `Job ${url.slice(-1)}`,
    location: "Berlin",
    remote: "unknown",
    seniority: "unknown",
    skills: ["Node.js"],
    description: "We build booking software for clinics and run it on Node.js. ".repeat(12),
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    sources: [{ name: "greenhouse:examplecorp", url }],
    canonicalUrl: url,
    board: "greenhouse",
    flags: [],
    ...overrides,
  };
}

describe("closedSince", () => {
  const jobA = posting("https://boards.example.com/jobs/a");
  const jobB = posting("https://boards.example.com/jobs/b");

  it("flags a posting missing from the latest fetch as closed", () => {
    const closed = closedSince([jobA, jobB], [jobA]);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.id).toBe(jobB.id);
    expect(closed[0]?.flags).toContain("closed");
  });

  it("returns nothing when every posting is still present, matching by id or address", () => {
    expect(closedSince([jobA, jobB], [jobB, jobA])).toEqual([]);
    expect(closedSince([jobA], [{ ...jobA, id: "other-id" }])).toEqual([]);
  });

  it("does not change the postings it was given", () => {
    closedSince([jobA, jobB], []);
    expect(jobB.flags).toEqual([]);
  });
});

describe("markReposts", () => {
  const earlier = posting("https://boards.example.com/jobs/a", {
    postedAt: "2026-10-01T00:00:00.000Z",
  });

  it("marks the same job under a new date as a repost with a count", () => {
    const again = posting("https://boards.example.com/jobs/a", {
      postedAt: "2026-11-01T00:00:00.000Z",
    });
    const [marked] = markReposts([earlier], [again], NOW);
    expect(marked?.flags).toEqual(expect.arrayContaining(["repost", "reposts:1"]));
  });

  it("recognises the same job by company, title and location when the address changed", () => {
    const moved = posting("https://boards.example.com/jobs/z", {
      title: earlier.title,
      postedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(markReposts([earlier], [moved], NOW)[0]?.flags).toContain("repost");
  });

  it("does not mark an unchanged date, a new job, or a posting without a date", () => {
    const same = posting("https://boards.example.com/jobs/a", {
      postedAt: "2026-10-01T00:00:00.000Z",
    });
    const fresh = posting("https://boards.example.com/jobs/q", {
      postedAt: "2026-11-01T00:00:00.000Z",
    });
    const undated = posting("https://boards.example.com/jobs/a");
    expect(markReposts([earlier], [same, fresh, undated], NOW).map((job) => job.flags)).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("counts repeated reposts and makes the job a ghost suspect at three", () => {
    let history = earlier;
    for (const date of ["2026-10-10", "2026-10-20", "2026-11-01"]) {
      const next = posting("https://boards.example.com/jobs/a", {
        postedAt: `${date}T00:00:00.000Z`,
      });
      history = markReposts([history], [next], NOW)[0] as Posting;
    }
    expect(history.flags).toContain("reposts:3");
    expect(history.flags.filter((flag) => flag.startsWith("reposts:"))).toHaveLength(1);
    expect(history.flags).toContain("ghost-suspect");
  });
});
