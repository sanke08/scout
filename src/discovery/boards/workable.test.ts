/** Properties of the Workable parser, checked against a saved fictional response. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkable, workableUrl } from "./workable.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseWorkable", () => {
  const postings = parseWorkable(fixture("workable-harbor-systems.json"), "harbor-systems", NOW);

  it("reads company, location, remote type and seniority", () => {
    expect(postings.map((posting) => posting.title)).toEqual([
      "Customer Support Specialist",
      "Junior QA Engineer",
    ]);
    expect(postings[0]).toMatchObject({
      company: "Harbor Systems",
      board: "workable",
      location: "Rotterdam, South Holland, Netherlands",
      remote: "onsite",
      canonicalUrl: "https://apply.workable.com/j/HS01A2B3",
    });
    expect(postings[1]).toMatchObject({ remote: "remote", seniority: "junior" });
    expect(postings[1]?.skills).toEqual(expect.arrayContaining(["Playwright", "Cypress"]));
  });

  it("builds the board address from the token", () => {
    expect(workableUrl("harbor-systems")).toBe(
      "https://apply.workable.com/api/v1/widget/accounts/harbor-systems?details=true",
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => parseWorkable("nope", "harbor-systems", NOW)).toThrow(
      /workable:harbor-systems board did not return valid JSON/,
    );
  });
});
