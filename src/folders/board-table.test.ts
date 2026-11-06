import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOARD_FILE_NAME, buildBoardTable, writeBoardTable } from "./board-table.js";
import { createJobFolderManager } from "./job-folder.js";
import type { JobFolderManager } from "./job-folder.js";
import { fixedClock, makePosting, makeTemporaryFolder } from "./test-helpers.js";

let temporary: ReturnType<typeof makeTemporaryFolder>;
let jobsDirectory: string;
let folders: JobFolderManager;

beforeEach(() => {
  temporary = makeTemporaryFolder();
  jobsDirectory = join(temporary.path, "jobs");
  folders = createJobFolderManager({ jobsDirectory, now: fixedClock() });
});
afterEach(() => temporary.remove());

/** Creates a job with the given company and status. */
function addJob(company: string, status: string): string {
  const { name } = folders.ensureJobFolder(
    makePosting({ id: company, company, canonicalUrl: `https://example.com/${company}` }),
  );
  folders.updateFrontMatter(name, { status });
  return name;
}

describe("buildBoardTable", () => {
  it("orders rows by status, then by folder, and shows the totals line", () => {
    addJob("Bravo", "found");
    addJob("Alpha", "found");
    addJob("Charlie", "interviewing");
    addJob("Delta", "closed");
    addJob("Echo", "applied");
    addJob("Foxtrot", "offer");
    addJob("Golf", "contacted");
    addJob("Hotel", "resume-ready");
    addJob("India", "rejected");
    addJob("Juliet", "withdrawn");
    addJob("Kilo", "needs-you");

    const board = buildBoardTable(jobsDirectory);
    expect(board.rows.map((row) => row.company)).toEqual([
      "Charlie",
      "Foxtrot",
      "Golf",
      "Echo",
      "Hotel",
      "Alpha",
      "Bravo",
      "India",
      "Delta",
      "Juliet",
      "Kilo",
    ]);
    expect(board.totals).toMatchObject({ found: 2, interviewing: 1, "needs-you": 1 });
    expect(board.markdown).toContain("Total: 11 jobs (interviewing 1, offer 1");
    expect(board.markdown.split("\n").filter((line) => line.startsWith("| ")).length).toBe(2 + 11);
  });

  it("skips and reports a job.md with no front matter and a folder with no job.md", () => {
    addJob("Alpha", "found");
    mkdirSync(join(jobsDirectory, "2026-01-01_Broken_Role"));
    writeFileSync(join(jobsDirectory, "2026-01-01_Broken_Role", "job.md"), "# no front matter\n");
    mkdirSync(join(jobsDirectory, "2026-01-02_Empty_Role"));
    writeFileSync(join(jobsDirectory, "notes.txt"), "a stray file");

    const board = buildBoardTable(jobsDirectory);
    expect(board.rows).toHaveLength(1);
    expect(board.skipped.map((item) => item.folder).sort()).toEqual([
      "2026-01-01_Broken_Role",
      "2026-01-02_Empty_Role",
    ]);
    expect(board.markdown).toContain("Folders left out");
  });

  it("keeps a hostile cell from breaking the table", () => {
    const name = addJob("Alpha", "found");
    folders.updateFrontMatter(name, { role: "Dev | Ops\nextra" });
    const row = buildBoardTable(jobsDirectory)
      .markdown.split("\n")
      .find((line) => line.includes("Dev"));
    expect(row).toContain("Dev \\| Ops extra");
  });

  it("gives an empty table for a missing jobs folder", () => {
    const board = buildBoardTable(join(temporary.path, "nothing"));
    expect(board.rows).toEqual([]);
    expect(board.markdown).toContain("Total: 0 jobs");
  });

  it("is rebuilt from the records only: writing twice gives the same file", () => {
    addJob("Alpha", "found");
    writeBoardTable(jobsDirectory);
    const first = readFileSync(join(jobsDirectory, BOARD_FILE_NAME), "utf8");
    writeBoardTable(jobsDirectory);
    expect(readFileSync(join(jobsDirectory, BOARD_FILE_NAME), "utf8")).toBe(first);
  });
});
