/** Properties of the Lever parser, checked against a saved fictional response. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leverUrl, parseLever } from "./lever.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseLever", () => {
  const postings = parseLever(fixture("lever-examplecorp.json"), "examplecorp", NOW);

  it("returns one posting per job with the hosted address stripped of tracking", () => {
    expect(postings.map((posting) => posting.title)).toEqual([
      "Senior Backend Engineer",
      "Data Analyst",
      "Staff Platform Engineer",
    ]);
    expect(postings[0]).toMatchObject({
      company: "Examplecorp",
      board: "lever",
      remote: "hybrid",
      canonicalUrl: "https://jobs.lever.co/examplecorp/7c1f0a52-0000-4000-8000-000000000001",
      postedAt: "2026-10-01T09:00:00.000Z",
    });
  });

  it("joins the description, the titled lists and the closing text", () => {
    const description = postings[0]?.description ?? "";
    expect(description).toContain("What you will do");
    expect(description).toContain("- Run services on Kubernetes with Docker and Terraform");
    expect(description).toContain("Apply on our careers page.");
  });

  it("uses the structured salary range and the workplace type", () => {
    expect(postings[2]?.salary).toEqual({
      min: 120000,
      max: 150000,
      currency: "EUR",
      period: "year",
    });
    expect(postings[2]?.remote).toBe("remote");
    expect(postings[2]?.seniority).toBe("lead");
  });

  it("builds the board address from the token", () => {
    expect(leverUrl("examplecorp")).toBe("https://api.lever.co/v0/postings/examplecorp?mode=json");
  });

  it("rejects malformed JSON and a body that is not a list", () => {
    expect(() => parseLever("{oops", "examplecorp", NOW)).toThrow(
      /lever:examplecorp board did not return valid JSON/,
    );
    expect(() => parseLever('{"jobs": []}', "examplecorp", NOW)).toThrow(/unexpected shape/);
  });
});
