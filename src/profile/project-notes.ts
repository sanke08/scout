/**
 * Verified project notes: plain Markdown files that describe one of the user's projects once,
 * and the parsing that turns them into data and into draft points.
 *
 * The note format is defined in this folder's README. Parsing is plain text reading with no
 * model, so it can only report what the note says, never add to it.
 *
 * Example: a file `message-queue.md` with `# Message Queue` and a `## Stack` section listing Go
 * becomes `{ title: "Message Queue", stack: ["Go"], ... }`.
 */
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { ScoutError, type Point } from "../shared/index.js";

/**
 * One parsed verified note.
 * - `fileName`: the Markdown file it came from, e.g. "message-queue.md".
 * - `title`: the project name (the first `# ` heading); never empty.
 * - `overview`: what the project is, in the note's words; empty if the section is missing.
 * - `verdict`: whether it is real, tutorial-derived, a demo or unfinished; empty if missing.
 * - `stack`: the real technologies, one term each.
 * - `features`: one entry per feature bullet.
 * - `doNotClaim`: statements the user must not make about the project.
 */
export interface ProjectNote {
  fileName: string;
  title: string;
  overview: string;
  verdict: string;
  stack: string[];
  features: string[];
  doNotClaim: string[];
}

/** The fields a section can fill. */
type SectionField = "overview" | "verdict" | "stack" | "features" | "doNotClaim";

/** The section headings of a note, lower-cased, mapped to the field they fill. */
const SECTION_FIELDS = new Map<string, SectionField>([
  ["overview", "overview"],
  ["verdict", "verdict"],
  ["stack", "stack"],
  ["features", "features"],
  ["do not claim", "doNotClaim"],
]);

/** The text lines under each recognised `## ` heading, keyed by field name. */
type Sections = Partial<Record<SectionField, string[]>>;

/**
 * Finds the project title: the text of the first line that starts with `# ` (one hash).
 * Returns an empty string when there is none.
 */
function findTitle(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return "";
}

/**
 * Splits the note into its fixed sections. A heading that is not one of the five fixed names
 * starts a section that is ignored, so extra notes written by hand do no harm.
 */
function splitSections(lines: readonly string[]): Sections {
  const sections: Sections = {};
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const field = SECTION_FIELDS.get(line.slice(3).trim().toLowerCase());
      if (field === undefined) {
        current = undefined;
      } else {
        current = sections[field] ?? [];
        sections[field] = current;
      }
    } else if (!line.startsWith("# ")) {
      current?.push(line);
    }
  }
  return sections;
}

/** Joins the non-empty lines of a section into one paragraph of plain text. */
function toParagraph(lines: readonly string[] | undefined): string {
  return (lines ?? [])
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

/**
 * Reads a bullet list: every line starting with `- ` or `* ` is one item. A following indented
 * line continues the item. Other lines are ignored.
 */
function toBullets(lines: readonly string[] | undefined): string[] {
  const items: string[] = [];
  for (const line of lines ?? []) {
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet !== null && !line.startsWith(" ")) {
      const text = (bullet[1] ?? "").trim();
      if (text !== "") {
        items.push(text);
      }
    } else if (/^\s+\S/.test(line) && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    }
  }
  return items;
}

/**
 * Reads the stack terms: bullets, or plain lines with comma-separated terms, or both.
 * Example: lines `- Go` and `PostgreSQL, Redis` give `["Go", "PostgreSQL", "Redis"]`.
 * Duplicates (ignoring case) are dropped.
 */
function toStackTerms(lines: readonly string[] | undefined): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of lines ?? []) {
    const withoutBullet = line.trim().replace(/^[-*]\s+/, "");
    for (const piece of withoutBullet.split(",")) {
      const term = piece.trim();
      if (term !== "" && !seen.has(term.toLowerCase())) {
        seen.add(term.toLowerCase());
        terms.push(term);
      }
    }
  }
  return terms;
}

/**
 * Parses the text of one note.
 *
 * Missing sections give empty values. A note with no `# Title` line throws `invalid-input`
 * naming the file, because a note without a title cannot be matched to a project.
 */
export function parseProjectNote(fileName: string, markdown: string): ProjectNote {
  const lines = markdown.split(/\r?\n/);
  const title = findTitle(lines);
  if (title === "") {
    throw new ScoutError(
      "invalid-input",
      `The project note ${fileName} has no title. Start the file with a line like "# Message Queue" naming the project.`,
    );
  }
  const sections = splitSections(lines);
  return {
    fileName,
    title,
    overview: toParagraph(sections.overview),
    verdict: toParagraph(sections.verdict),
    stack: toStackTerms(sections.stack),
    features: toBullets(sections.features),
    doNotClaim: toBullets(sections.doNotClaim),
  };
}

/**
 * Loads every `*.md` file (not folders) in the folder as a parsed note, sorted by file name.
 *
 * A folder that does not exist means no notes yet and gives an empty list. A note with no title
 * makes the whole load throw `invalid-input` naming that file; a folder that cannot be read
 * throws `unavailable`.
 */
export function loadProjectNotes(directory: string): ProjectNote[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw new ScoutError(
      "unavailable",
      `Scout could not read the project notes folder ${directory} (${error instanceof Error ? error.message : String(error)}). Check that it is a readable folder.`,
    );
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseProjectNote(name, readFileSync(join(directory, name), "utf8")));
}

/** Escapes characters that mean something in a regular expression. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `term` appears in `text` as a whole word with the same capitalisation. */
function mentionsTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![\\w])${escapeForPattern(term)}(?![\\w])`).test(text);
}

/**
 * Drafts one point per feature of the note, ready for the user to review.
 *
 * Each draft has status `hold`, so no resume can use it until the user changes the status.
 * Its `allowed` terms are only those stack terms of the note that appear in the feature's own
 * words (same capitalisation, whole word); nothing is invented, and a feature that names no
 * stack term gets an empty list for the user to fill in.
 *
 * Example: stack `["Go", "Redis"]`, feature "Cached lookups in Redis" gives one point with
 * allowed `["Redis"]`, status `hold`, no variants.
 */
export function draftPointsFromNote(note: ProjectNote): Point[] {
  return note.features.map((feature) => ({
    text: feature,
    allowed: note.stack.filter((term) => mentionsTerm(feature, term)),
    variants: [],
    status: "hold",
  }));
}
