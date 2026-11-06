/** Properties of the SmartRecruiters parser, checked against saved fictional responses. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseSmartRecruiters,
  readSmartRecruitersDescription,
  readSmartRecruitersIds,
  smartRecruitersDetailUrl,
  smartRecruitersUrl,
} from "./smartrecruiters.js";

/** The fixed "now" every test uses, so output is deterministic. */
const NOW = new Date("2026-11-07T09:00:00.000Z");

/** Reads a saved board response from `fixtures/boards/`. */
function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/boards/${name}`, import.meta.url), "utf8");
}

describe("SmartRecruiters", () => {
  const list = fixture("smartrecruiters-harbor-systems.json");
  const descriptions = new Map([
    [
      "7440001",
      readSmartRecruitersDescription(
        fixture("smartrecruiters-harbor-systems-7440001.json"),
        "harbor-systems",
      ),
    ],
    [
      "7440002",
      readSmartRecruitersDescription(
        fixture("smartrecruiters-harbor-systems-7440002.json"),
        "harbor-systems",
      ),
    ],
  ]);

  it("lists the posting ids so the caller can fetch each text", () => {
    expect(readSmartRecruitersIds(list, "harbor-systems")).toEqual(["7440001", "7440002"]);
  });

  it("joins the detail sections into one description", () => {
    expect(descriptions.get("7440001")).toContain("Kafka");
    expect(descriptions.get("7440001")).toContain("Qualifications");
  });

  it("builds postings from the list and the fetched texts", () => {
    const postings = parseSmartRecruiters(list, "harbor-systems", NOW, descriptions);
    expect(postings.map((posting) => posting.title)).toEqual([
      "Data Engineer",
      "Site Reliability Engineer",
    ]);
    expect(postings[0]).toMatchObject({
      company: "Harbor Systems",
      board: "smartrecruiters",
      location: "Hamburg, Germany",
      canonicalUrl: "https://jobs.smartrecruiters.com/harbor-systems/7440001",
    });
    expect(postings[0]?.skills).toEqual(
      expect.arrayContaining(["Python", "Kafka", "Spark", "ClickHouse"]),
    );
    expect(postings[1]?.remote).toBe("remote");
  });

  it("gives an empty description when no text was fetched", () => {
    expect(parseSmartRecruiters(list, "harbor-systems", NOW, new Map())[0]?.description).toBe("");
  });

  it("builds addresses", () => {
    expect(smartRecruitersUrl("harbor-systems")).toBe(
      "https://api.smartrecruiters.com/v1/companies/harbor-systems/postings",
    );
    expect(smartRecruitersDetailUrl("harbor-systems", "7440001")).toBe(
      "https://api.smartrecruiters.com/v1/companies/harbor-systems/postings/7440001",
    );
  });

  it("rejects malformed JSON in the list and in a detail", () => {
    expect(() => parseSmartRecruiters("{", "harbor-systems", NOW, new Map())).toThrow(/valid JSON/);
    expect(() => readSmartRecruitersDescription("{", "harbor-systems")).toThrow(/valid JSON/);
  });
});
