/**
 * Leads files: jobs that were found but not yet pursued, saved as dated lists.
 *
 * Why it exists: IDEA 5.11 says leads are kept as one list per source and per round, each with a
 * status column (blank, applied, skipped), and a lead becomes a job folder only when the user
 * picks it. A lead has no folder and no database record.
 *
 * File name: `YYYY-MM-DD_<source>-roundN.md`, where N is the next round for that source on that
 * day (the first is round1). Example: `2026-11-07_greenhouse-round2.md`.
 *
 * Example:
 *   const saved = writeLeadsFile(dir, "greenhouse", new Date(), rows); // { path, round: 1 }
 *   markLead(saved.path, 3, "applied");  // row 3 now ends with "applied"
 *   latestLeadsFile(dir, "greenhouse");  // path of the newest list for that source
 * Failure: an unusable source name throws `ScoutError("invalid-input")`; a row number that is not
 * in the file throws `ScoutError("not-found")`; a file that is not a leads file is refused with
 * `ScoutError("unsafe")`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ScoutError } from "../shared/index.js";
import { writeTextAtomic } from "./atomic-file.js";
import { tableCell, tableHeader, tableRow } from "./markdown-table.js";
import { isoDate } from "./time-format.js";

/** The values a lead's Status cell may hold. Blank means not decided yet. */
export type LeadStatus = "" | "applied" | "skipped";

/** One lead as the caller describes it. */
export interface LeadRow {
  company: string;
  role: string;
  /** Link to the posting; the role is shown as a Markdown link when given. */
  link?: string;
  location: string;
  /** Experience asked, as written, or `unknown`. */
  experience: string;
  /** Skills the posting lists. */
  listedSkills: string[];
  /** Listed skills the profile does not hold (never added to a resume). */
  missing: string[];
  notes: string;
}

/** What `writeLeadsFile` reports. */
export interface SavedLeadsFile {
  path: string;
  round: number;
}

/** A row's number and its current status, as read back from a file. */
export interface LeadStatusEntry {
  number: number;
  status: LeadStatus;
}

/** The columns of a leads table, in order. */
const LEAD_COLUMNS = [
  "#",
  "Company",
  "Role",
  "Location",
  "Exp",
  "Listed skills",
  "Missing",
  "Notes",
  "Status",
];

/** Matches a leads file name and captures date, source and round. */
const LEADS_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})_([A-Za-z0-9-]+)-round(\d+)\.md$/;

/** Allowed source names: letters, digits and hyphens, so the file name stays unambiguous. */
const SOURCE_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/** Throws unless `source` can be part of a leads file name. */
function assertSource(source: string): void {
  if (!SOURCE_PATTERN.test(source)) {
    throw new ScoutError(
      "invalid-input",
      `The source name "${source.slice(0, 60)}" may only contain letters, digits and single hyphens, for example "greenhouse" or "remote-feed".`,
    );
  }
}

/** All leads files in `directory` as parsed names, or none if the folder does not exist. */
function listLeadsFiles(
  directory: string,
): { name: string; date: string; source: string; round: number }[] {
  if (!existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(directory)) {
    const match = LEADS_FILE_PATTERN.exec(name);
    if (match !== null) {
      files.push({
        name,
        date: match[1] as string,
        source: match[2] as string,
        round: Number(match[3]),
      });
    }
  }
  return files;
}

/** Percent-encodes the characters that would end a Markdown link or a table cell early. */
function escapeLinkAddress(address: string): string {
  return address.replace(/[()|\s]/g, (character) =>
    character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0").replace(/^/, "%"),
  );
}

/** Renders one lead as a table row; the number is its position starting at 1. */
function renderLeadRow(number: number, row: LeadRow): string {
  const role =
    row.link === undefined || row.link === ""
      ? tableCell(row.role)
      : `[${tableCell(row.role).replace(/[[\]]/g, "")}](${escapeLinkAddress(row.link)})`;
  return tableRow([
    String(number),
    tableCell(row.company),
    role,
    tableCell(row.location),
    tableCell(row.experience),
    tableCell(row.listedSkills.join(", ")),
    tableCell(row.missing.join(", ")),
    tableCell(row.notes),
    "",
  ]);
}

/**
 * Saves a new leads list and returns where. The round number is one more than the highest round
 * already saved for this source on this day. `date` is the day the list was made (UTC).
 */
export function writeLeadsFile(
  directory: string,
  source: string,
  date: Date,
  rows: LeadRow[],
): SavedLeadsFile {
  assertSource(source);
  const day = isoDate(date);
  const rounds = listLeadsFiles(directory)
    .filter((file) => file.date === day && file.source === source)
    .map((file) => file.round);
  const round = Math.max(0, ...rounds) + 1;
  const path = join(directory, `${day}_${source}-round${round}.md`);
  const text = [
    `# Leads from ${source}, ${day}, round ${round}`,
    "",
    `How this list was made: Scout read the public ${source} job list on ${day}, removed postings that break your hard rules, and kept the rest in the order of how many of their listed skills your profile holds. Nothing here has been applied to. A lead becomes a job folder only when you pick it. Set the Status column to applied or skipped as you go; leave it blank if undecided.`,
    "",
    ...tableHeader(LEAD_COLUMNS),
    ...rows.map((row, index) => renderLeadRow(index + 1, row)),
    "",
  ].join("\n");
  mkdirSync(directory, { recursive: true });
  writeTextAtomic(path, text);
  return { path, round };
}

/**
 * Finds the newest leads file (latest date, then highest round) in `directory`, optionally for
 * one source. Returns `undefined` when there is none.
 */
export function latestLeadsFile(directory: string, source?: string): string | undefined {
  const files = listLeadsFiles(directory).filter(
    (file) => source === undefined || file.source === source,
  );
  files.sort((first, second) =>
    first.date === second.date ? first.round - second.round : first.date < second.date ? -1 : 1,
  );
  const newest = files[files.length - 1];
  return newest === undefined ? undefined : join(directory, newest.name);
}

/** Refuses any file that is not named like a leads file. */
function assertLeadsFile(path: string): void {
  if (!LEADS_FILE_PATTERN.test(basename(path))) {
    throw new ScoutError(
      "unsafe",
      `"${basename(path).slice(0, 60)}" is not a leads file (named like 2026-11-07_greenhouse-round1.md), so Scout did not change it.`,
    );
  }
}

/** Splits `text` into lines and returns the lines that are numbered table rows. */
function isNumberedRow(line: string): boolean {
  return /^\|\s*\d+\s*\|.*\|\s*$/.test(line);
}

/** The number in the first cell of a numbered row line. */
function rowNumber(line: string): number {
  return Number(/^\|\s*(\d+)\s*\|/.exec(line)?.[1]);
}

/** Reads each row's number and status from a leads file. */
export function readLeadStatuses(path: string): LeadStatusEntry[] {
  assertLeadsFile(path);
  const entries: LeadStatusEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!isNumberedRow(line)) {
      continue;
    }
    const trimmed = line.trimEnd();
    const cell = trimmed.slice(trimmed.lastIndexOf("|", trimmed.length - 2) + 1, -1).trim();
    entries.push({
      number: rowNumber(line),
      status: cell === "applied" || cell === "skipped" ? cell : "",
    });
  }
  return entries;
}

/**
 * Sets the Status cell of row `number` (counting from 1) to `applied`, `skipped` or blank.
 * Only that cell changes; the rest of the file is kept exactly.
 */
export function markLead(path: string, number: number, status: LeadStatus): void {
  assertLeadsFile(path);
  if (!existsSync(dirname(path)) || !existsSync(path)) {
    throw new ScoutError("not-found", `The leads file ${basename(path)} does not exist.`);
  }
  const lines = readFileSync(path, "utf8").split("\n");
  const index = lines.findIndex((line) => isNumberedRow(line) && rowNumber(line) === number);
  if (index < 0) {
    throw new ScoutError(
      "not-found",
      `There is no row ${number} in ${basename(path)}, so no lead was marked.`,
    );
  }
  const line = (lines[index] as string).trimEnd();
  const statusStart = line.lastIndexOf("|", line.length - 2);
  lines[index] = `${line.slice(0, statusStart + 1)} ${status} |`.replace(/ {2,}\|$/, " |");
  writeTextAtomic(path, lines.join("\n"));
}
