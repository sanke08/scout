/**
 * The generated job board: one Markdown table of every job folder and its status.
 *
 * Why it exists: IDEA 5.11 wants "a board table of every job and status" generated from the
 * records, never kept by hand. The `job.md` files are the only source of truth; this table is
 * rebuilt from them and may be deleted and rebuilt at any time.
 *
 * Rows are ordered by status (interviewing, offer, contacted, applied, resume-ready, found,
 * rejected, closed, withdrawn, then every other status, then any unrecognised word), and inside a
 * status by folder name. A folder with no `job.md`, or a `job.md` with no front matter, is left
 * out of the table and reported in `skipped`, so a damaged record is visible and not hidden.
 *
 * Example: `buildBoardTable("/data/jobs").markdown` starts with `# Job board` and has one row
 * per job; `writeBoardTable("/data/jobs")` saves it as `/data/jobs/BOARD.md`.
 * Failure: a missing jobs folder gives an empty table; unreadable files throw the Node error.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { JOB_STATUSES } from "../shared/index.js";
import { writeTextAtomic } from "./atomic-file.js";
import { parseFrontMatter, UNKNOWN_VALUE } from "./front-matter.js";
import { JOB_FILE_NAME } from "./job-folder.js";
import { tableCell, tableHeader, tableRow } from "./markdown-table.js";

/** The file the board table is written to, inside the jobs folder. */
export const BOARD_FILE_NAME = "BOARD.md";

/** The statuses shown first, in the order the owner chose; the rest follow in a fixed order. */
const LEADING_STATUS_ORDER = [
  "interviewing",
  "offer",
  "contacted",
  "applied",
  "resume-ready",
  "found",
  "rejected",
  "closed",
  "withdrawn",
];

/** Every status in display order: the leading ones, then all the remaining known statuses. */
export const BOARD_STATUS_ORDER: string[] = [
  ...LEADING_STATUS_ORDER,
  ...JOB_STATUSES.filter((status) => !LEADING_STATUS_ORDER.includes(status)),
];

/** One job as shown on the board. */
export interface BoardRow {
  folder: string;
  status: string;
  company: string;
  role: string;
  location: string;
  applied: string;
  link: string;
}

/** A folder left out of the board, and why. */
export interface SkippedFolder {
  folder: string;
  reason: string;
}

/** The result of `buildBoardTable`. */
export interface BoardTable {
  /** The whole Markdown document. */
  markdown: string;
  /** The rows in display order. */
  rows: BoardRow[];
  /** Number of jobs per status, for example `{ applied: 2, found: 3 }`. */
  totals: Record<string, number>;
  /** Folders that could not be read as jobs. */
  skipped: SkippedFolder[];
}

/** Position of a status in the display order; unrecognised words sort last. */
function statusRank(status: string): number {
  const index = BOARD_STATUS_ORDER.indexOf(status);
  return index === -1 ? BOARD_STATUS_ORDER.length : index;
}

/** Reads one job folder into a row, or says why it cannot be. */
function readRow(jobsDirectory: string, folder: string): BoardRow | SkippedFolder {
  const file = join(jobsDirectory, folder, JOB_FILE_NAME);
  if (!existsSync(file)) {
    return { folder, reason: `The folder has no ${JOB_FILE_NAME}.` };
  }
  const parsed = parseFrontMatter(readFileSync(file, "utf8"));
  if (parsed === undefined) {
    return { folder, reason: `The ${JOB_FILE_NAME} has no front matter between two --- lines.` };
  }
  const fields = parsed.fields;
  return {
    folder,
    status: fields["status"] ?? UNKNOWN_VALUE,
    company: fields["company"] ?? UNKNOWN_VALUE,
    role: fields["role"] ?? UNKNOWN_VALUE,
    location: fields["location"] ?? UNKNOWN_VALUE,
    applied: fields["applied"] ?? UNKNOWN_VALUE,
    link: fields["link"] ?? UNKNOWN_VALUE,
  };
}

/** Builds the totals line, for example `Total: 3 jobs (applied 1, found 2)`. */
function totalsLine(totals: Record<string, number>, count: number): string {
  const parts = Object.entries(totals)
    .sort(([first], [second]) => statusRank(first) - statusRank(second))
    .map(([status, number]) => `${status} ${number}`);
  const noun = count === 1 ? "job" : "jobs";
  return parts.length === 0 ? `Total: 0 jobs` : `Total: ${count} ${noun} (${parts.join(", ")})`;
}

/**
 * Reads every job folder under `jobsDirectory` and renders the board.
 * Files and folders whose names start with a dot are ignored.
 */
export function buildBoardTable(jobsDirectory: string): BoardTable {
  const rows: BoardRow[] = [];
  const skipped: SkippedFolder[] = [];
  const entries = existsSync(jobsDirectory) ? readdirSync(jobsDirectory).sort() : [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !statSync(join(jobsDirectory, entry)).isDirectory()) {
      continue;
    }
    const result = readRow(jobsDirectory, entry);
    if ("reason" in result) {
      skipped.push(result);
    } else {
      rows.push(result);
    }
  }
  rows.sort(
    (first, second) =>
      statusRank(first.status) - statusRank(second.status) ||
      (first.folder < second.folder ? -1 : first.folder > second.folder ? 1 : 0),
  );
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.status] = (totals[row.status] ?? 0) + 1;
  }
  const lines = [
    "# Job board",
    "",
    "Generated by Scout from the `job.md` file in each job folder. Do not edit this file; change the job's own record instead.",
    "",
    totalsLine(totals, rows.length),
    "",
    ...tableHeader(["Status", "Company", "Role", "Location", "Applied", "Folder", "Link"]),
    ...rows.map((row) =>
      tableRow(
        [row.status, row.company, row.role, row.location, row.applied, row.folder, row.link].map(
          tableCell,
        ),
      ),
    ),
  ];
  if (skipped.length > 0) {
    lines.push("", "## Folders left out", "");
    for (const item of skipped) {
      lines.push(`- ${tableCell(item.folder)}: ${item.reason}`);
    }
  }
  return { markdown: `${lines.join("\n")}\n`, rows, totals, skipped };
}

/**
 * Builds the board and saves it (atomically) as `BOARD.md` inside the jobs folder, or at
 * `outputPath` if given. Returns the board so the caller can report what was skipped.
 */
export function writeBoardTable(jobsDirectory: string, outputPath?: string): BoardTable {
  const board = buildBoardTable(jobsDirectory);
  const target = outputPath ?? join(jobsDirectory, BOARD_FILE_NAME);
  mkdirSync(dirname(target), { recursive: true });
  writeTextAtomic(target, board.markdown);
  return board;
}
