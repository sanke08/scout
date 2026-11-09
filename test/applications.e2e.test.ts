/**
 * End-to-end test of `scout applications`, through the real entry point: a recruiter calls, the
 * user finds the application, records the call and a rejection, and the ledger file shows it all.
 * Fictional data only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXED_NOW, makeDataFolder, runCli } from "./helpers.js";

let folder: ReturnType<typeof makeDataFolder>;

beforeEach(() => {
  folder = makeDataFolder();
});

afterEach(() => {
  folder.remove();
});

/** Runs one command in the test data folder with the fixed clock. */
function run(...args: string[]): ReturnType<typeof runCli> {
  return runCli(["applications", ...args], { directory: folder.directory, now: () => FIXED_NOW });
}

describe("scout applications", () => {
  it("records an application, finds it by the recruiter, logs a call and a rejection", async () => {
    const added = await run(
      "add",
      "--company",
      "Northwind",
      "--title",
      "Platform Engineer",
      "--link",
      "https://careers.example.com/jobs/NW-20931",
      "--on",
      "2026-11-02",
      "--recruiter",
      "Sam Okafor",
      "--phone",
      "+1 555 0100",
    );
    expect(added.errors).toEqual([]);
    const id = /id ([0-9a-f]{16})/.exec(added.lines.join("\n"))![1]!;

    const found = await run("find", "okafor");
    expect(found.lines.join("\n")).toContain("Northwind, Platform Engineer");

    const byPhone = await run("find", "555", "0100");
    expect(byPhone.lines.join("\n")).toContain(id);

    const logged = await run(
      "log",
      id.slice(0, 6),
      "call",
      "Phone screen booked for Friday",
      "--who",
      "Sam Okafor",
    );
    expect(logged.errors).toEqual([]);

    const rejected = await run(
      "status",
      id,
      "rejected",
      "Email from Sam: position filled",
      "--on",
      "2026-11-08",
    );
    expect(rejected.lines.join("\n")).toContain("now rejected");

    const shown = await run("show", id);
    const text = shown.lines.join("\n");
    expect(text).toContain("Sam Okafor");
    expect(text).toContain("+1 555 0100");
    expect(text).toContain("Phone screen booked for Friday");
    expect(text).toContain("position filled");

    const file = join(folder.directory, "APPLICATIONS.md");
    expect(existsSync(file)).toBe(true);
    const markdown = readFileSync(file, "utf8");
    expect(markdown).toContain("NW-20931");
    expect(markdown).toContain("https://careers.example.com/jobs/NW-20931");
    expect(markdown).toMatch(/## Finished[\s\S]*Northwind/);
  });

  it("says plainly when an id is unknown, a status is wrong or a move is illegal", async () => {
    const added = await run("add", "--company", "Contoso", "--title", "Backend Engineer");
    const id = /id ([0-9a-f]{16})/.exec(added.lines.join("\n"))![1]!;
    expect((await run("show", "zzzz")).errors.join(" ")).toContain("No application");
    expect((await run("status", id, "banana")).errors.join(" ")).toContain("not a status");
    expect((await run("status", id, "skipped")).errors.join(" ")).toMatch(
      /not a status|cannot be moved/,
    );
    expect((await run("status", id, "found")).errors.join(" ")).toContain("cannot be moved");
  });

  it("lists nothing on a fresh folder and exports an empty ledger file", async () => {
    expect((await run()).lines.join("\n")).toContain("No applications match.");
    const exported = await run("export");
    expect(existsSync(exported.lines.join("\n").trim())).toBe(true);
  });
});
