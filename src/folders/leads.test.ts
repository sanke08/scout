import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestLeadsFile, markLead, readLeadStatuses, writeLeadsFile } from "./leads.js";
import type { LeadRow } from "./leads.js";
import { makeTemporaryFolder } from "./test-helpers.js";

let temporary: ReturnType<typeof makeTemporaryFolder>;
beforeEach(() => {
  temporary = makeTemporaryFolder();
});
afterEach(() => temporary.remove());

const day = new Date("2026-11-07T09:00:00Z");

/** A fictional lead. */
function lead(company: string, overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    company,
    role: "Backend Engineer",
    link: "https://example.com/jobs/1",
    location: "Remote",
    experience: "3+ years",
    listedSkills: ["Node.js", "SQL"],
    missing: ["Kafka"],
    notes: "fits",
    ...overrides,
  };
}

describe("leads files", () => {
  it("numbers rounds per source and per day", () => {
    const first = writeLeadsFile(temporary.path, "greenhouse", day, [lead("A")]);
    const second = writeLeadsFile(temporary.path, "greenhouse", day, [lead("B")]);
    const other = writeLeadsFile(temporary.path, "lever", day, [lead("C")]);
    const nextDay = writeLeadsFile(
      temporary.path,
      "greenhouse",
      new Date("2026-11-08T09:00:00Z"),
      [],
    );
    expect([first.round, second.round, other.round, nextDay.round]).toEqual([1, 2, 1, 1]);
    expect(readdirSync(temporary.path).sort()).toEqual([
      "2026-11-07_greenhouse-round1.md",
      "2026-11-07_greenhouse-round2.md",
      "2026-11-07_lever-round1.md",
      "2026-11-08_greenhouse-round1.md",
    ]);
  });

  it("writes the how-it-was-made paragraph, the table columns and blank statuses", () => {
    const { path } = writeLeadsFile(temporary.path, "greenhouse", day, [
      lead("A"),
      lead("B | Co", { link: undefined }),
    ]);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("How this list was made");
    expect(text).toContain(
      "| # | Company | Role | Location | Exp | Listed skills | Missing | Notes | Status |",
    );
    expect(text).toContain("[Backend Engineer](https://example.com/jobs/1)");
    expect(text).toContain("B \\| Co");
    expect(readLeadStatuses(path)).toEqual([
      { number: 1, status: "" },
      { number: 2, status: "" },
    ]);
  });

  it("finds the latest file, overall and per source", () => {
    writeLeadsFile(temporary.path, "greenhouse", day, []);
    writeLeadsFile(temporary.path, "greenhouse", day, []);
    writeLeadsFile(temporary.path, "lever", new Date("2026-11-06T00:00:00Z"), []);
    expect(latestLeadsFile(temporary.path)).toBe(
      join(temporary.path, "2026-11-07_greenhouse-round2.md"),
    );
    expect(latestLeadsFile(temporary.path, "lever")).toBe(
      join(temporary.path, "2026-11-06_lever-round1.md"),
    );
    expect(latestLeadsFile(temporary.path, "ashby")).toBeUndefined();
    expect(latestLeadsFile(join(temporary.path, "missing"))).toBeUndefined();
  });

  it("marks one row applied or skipped and changes nothing else", () => {
    const { path } = writeLeadsFile(temporary.path, "greenhouse", day, [
      lead("A"),
      lead("B"),
      lead("C"),
    ]);
    const before = readFileSync(path, "utf8");
    markLead(path, 2, "applied");
    markLead(path, 3, "skipped");
    expect(readLeadStatuses(path)).toEqual([
      { number: 1, status: "" },
      { number: 2, status: "applied" },
      { number: 3, status: "skipped" },
    ]);
    markLead(path, 2, "");
    markLead(path, 3, "");
    expect(readLeadStatuses(path).map((entry) => entry.status)).toEqual(["", "", ""]);
    expect(readFileSync(path, "utf8").replace(/ +\|/g, " |")).toBe(before.replace(/ +\|/g, " |"));
    expect(readdirSync(temporary.path).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("refuses unknown rows, bad source names and files that are not leads files", () => {
    const { path } = writeLeadsFile(temporary.path, "greenhouse", day, [lead("A")]);
    expect(() => markLead(path, 9, "applied")).toThrow(/no row 9/);
    expect(() => writeLeadsFile(temporary.path, "../evil", day, [])).toThrow(/may only contain/);
    const stray = join(temporary.path, "notes.md");
    writeFileSync(stray, "| 1 | x | |");
    expect(() => markLead(stray, 1, "applied")).toThrow(/not a leads file/);
  });
});
