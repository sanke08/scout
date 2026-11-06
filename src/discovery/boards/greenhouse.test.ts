/** Properties of the Greenhouse parser, checked against a saved fictional response. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { greenhouseUrl, parseGreenhouse } from "./greenhouse.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseGreenhouse", () => {
  const postings = parseGreenhouse(fixture("greenhouse-examplecorp.json"), "examplecorp", NOW);

  it("returns one normalised posting per job", () => {
    expect(postings.map((posting) => posting.title)).toEqual([
      "Senior Backend Engineer",
      "Product Designer",
      "Software Engineering Intern",
    ]);
    const senior = postings[0];
    expect(senior).toMatchObject({
      company: "Examplecorp",
      location: "Berlin, Germany",
      board: "greenhouse",
      seniority: "senior",
      remote: "hybrid",
      canonicalUrl: "https://boards.greenhouse.io/examplecorp/jobs/4001001",
      postedAt: "2026-10-01T13:00:00.000Z",
      firstSeenAt: NOW.toISOString(),
      lastSeenAt: NOW.toISOString(),
    });
    expect(senior?.sources).toEqual([
      {
        name: "greenhouse:examplecorp",
        url: "https://boards.greenhouse.io/examplecorp/jobs/4001001",
      },
    ]);
  });

  it("strips markup from escaped HTML and keeps the words", () => {
    const description = postings[0]?.description ?? "";
    expect(description).not.toContain("<");
    expect(description).toContain("Design and build APIs in Node.js and TypeScript");
  });

  it("finds skills and salary named by the posting", () => {
    expect(postings[0]?.skills).toEqual(
      expect.arrayContaining([
        "Node.js",
        "TypeScript",
        "PostgreSQL",
        "Kubernetes",
        "Docker",
        "Terraform",
      ]),
    );
    expect(postings[0]?.salary).toEqual({
      min: 85000,
      max: 105000,
      currency: "EUR",
      period: "year",
    });
  });

  it("uses the board's structured pay range and reads remote from the location", () => {
    expect(postings[1]?.salary).toEqual({
      min: 65000,
      max: 80000,
      currency: "EUR",
      period: "year",
    });
    expect(postings[1]?.remote).toBe("remote");
    expect(postings[2]?.seniority).toBe("intern");
  });

  it("builds the board address from the token", () => {
    expect(greenhouseUrl("examplecorp")).toBe(
      "https://boards-api.greenhouse.io/v1/boards/examplecorp/jobs?content=true",
    );
  });

  it("rejects malformed JSON and wrong shapes with an error that names the board", () => {
    expect(() => parseGreenhouse(fixture("malformed-board.txt"), "examplecorp", NOW)).toThrow(
      /greenhouse:examplecorp board did not return valid JSON/,
    );
    expect(() => parseGreenhouse('{"nothing": []}', "examplecorp", NOW)).toThrow(
      /greenhouse:examplecorp.*unexpected shape/,
    );
  });

  it("skips entries that lack a title or address", () => {
    const body = JSON.stringify({
      jobs: [{ title: "No link" }, 7, { title: "Ok", absolute_url: "https://example.com/j/1" }],
    });
    expect(parseGreenhouse(body, "examplecorp", NOW).map((posting) => posting.title)).toEqual([
      "Ok",
    ]);
  });
});
