/** Properties of the Recruitee parser, checked against a saved fictional response. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecruitee, recruiteeUrl } from "./recruitee.js";

const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("parseRecruitee", () => {
  const postings = parseRecruitee(fixture("recruitee-harbor-systems.json"), "harbor-systems", NOW);

  it("keeps published offers only", () => {
    expect(postings.map((posting) => posting.title)).toEqual(["Backend Developer"]);
  });

  it("reads the offer, joins requirements, and finds the salary written in them", () => {
    expect(postings[0]).toMatchObject({
      company: "Harbor Systems",
      board: "recruitee",
      location: "Rotterdam, Netherlands",
      canonicalUrl: "https://harbor-systems.recruitee.com/o/backend-developer",
      postedAt: "2026-10-06T08:00:00.000Z",
      salary: { min: 60000, max: 75000, currency: "EUR", period: "year" },
    });
    expect(postings[0]?.skills).toEqual(
      expect.arrayContaining(["Java", "Spring Boot", "PostgreSQL", "RabbitMQ", "AWS"]),
    );
    expect(postings[0]?.description).toContain("- Two years of Java");
  });

  it("builds the board address from the token", () => {
    expect(recruiteeUrl("harbor-systems")).toBe("https://harbor-systems.recruitee.com/api/offers/");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseRecruitee("[[", "harbor-systems", NOW)).toThrow(
      /recruitee:harbor-systems board did not return valid JSON/,
    );
  });
});
