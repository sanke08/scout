/** Properties of the Ashby parser, checked against a saved fictional response. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ashbyUrl, parseAshby } from "./ashby.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseAshby", () => {
  const postings = parseAshby(fixture("ashby-examplecorp.json"), "examplecorp", NOW);

  it("skips unlisted jobs", () => {
    expect(postings.map((posting) => posting.title)).toEqual([
      "Sr. Backend Engineer",
      "Lead Data Engineer",
    ]);
  });

  it("reads the posting fields", () => {
    expect(postings[0]).toMatchObject({
      company: "Examplecorp",
      board: "ashby",
      location: "Berlin",
      remote: "hybrid",
      seniority: "senior",
      postedAt: "2026-10-02T07:30:00.000Z",
      canonicalUrl: "https://jobs.ashbyhq.com/examplecorp/a1b2c3d4-0000-4000-8000-000000000001",
    });
    expect(postings[1]?.remote).toBe("remote");
    expect(postings[1]?.skills).toEqual(
      expect.arrayContaining(["Python", "Airflow", "Spark", "dbt", "Snowflake"]),
    );
  });

  it("builds the board address from the token", () => {
    expect(ashbyUrl("examplecorp")).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/examplecorp",
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAshby("<html>", "examplecorp", NOW)).toThrow(
      /ashby:examplecorp board did not return valid JSON/,
    );
  });
});
