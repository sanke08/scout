/**
 * Reading and updating the small `key: value` block at the top of a Markdown file.
 *
 * Why it exists: `job.md` starts with a front-matter block (status, company, link and so on) that
 * both people and Scout read. The format is deliberately simple and tolerant of hand edits:
 * keys are case-insensitive and spaces count as underscores ("Resume Sent" is `resume_sent`),
 * lines without a colon are ignored, and everything after the closing `---` is left alone.
 *
 * Example: for the text `---\nstatus: found\ncompany: Acme\n---\n# Body`,
 * `parseFrontMatter(text)` gives `{ fields: { status: "found", company: "Acme" }, body: "# Body" }`
 * and `patchFrontMatter(text, { status: "applied" })` changes only the status line.
 * Failure: a file with no opening or no closing `---` gives `undefined` from `parseFrontMatter`
 * (the caller decides what to do); `patchFrontMatter` throws `ScoutError("invalid-input")`.
 */
import { ScoutError } from "../shared/index.js";

/** The text written for a field whose value is not known. Never a guess. */
export const UNKNOWN_VALUE = "unknown";

/** A parsed front-matter block and the text that follows it. */
export interface ParsedFrontMatter {
  /** Field values by normalised key, for example `{ resume_sent: "sent/Alex_Acme.pdf" }`. */
  fields: Record<string, string>;
  /** Everything after the closing `---` line. */
  body: string;
}

/** The marker line that opens and closes the block. */
const FENCE = "---";

/** Turns "Resume Sent " into `resume_sent`: lowercase, runs of other characters become `_`. */
export function normaliseKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Makes one value safe for a single line: line breaks become spaces; empty becomes `unknown`. */
export function cleanValue(value: string): string {
  const oneLine = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return oneLine === "" ? UNKNOWN_VALUE : oneLine;
}

/** Removes a leading byte-order mark that some editors add. */
function withoutBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** Splits text into lines and finds the closing fence; returns undefined if there is no block. */
function findBlock(text: string): { lines: string[]; closingIndex: number } | undefined {
  const lines = withoutBom(text).split(/\r?\n/);
  let openingIndex = 0;
  while (openingIndex < lines.length && (lines[openingIndex] ?? "").trim() === "") {
    openingIndex += 1;
  }
  if ((lines[openingIndex] ?? "").trim() !== FENCE) {
    return undefined;
  }
  for (let index = openingIndex + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === FENCE) {
      return { lines: lines.slice(openingIndex), closingIndex: index - openingIndex };
    }
  }
  return undefined;
}

/**
 * Reads the front-matter block at the top of `text`.
 * Returns `undefined` when the text has no complete block.
 */
export function parseFrontMatter(text: string): ParsedFrontMatter | undefined {
  const block = findBlock(text);
  if (block === undefined) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const line of block.lines.slice(1, block.closingIndex)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 1) {
      continue;
    }
    const key = normaliseKey(line.slice(0, colonIndex));
    if (key !== "") {
      fields[key] = cleanValue(line.slice(colonIndex + 1));
    }
  }
  return { fields, body: block.lines.slice(block.closingIndex + 1).join("\n") };
}

/** Renders a block from fields, one `key: value` line each, in the order given. */
export function renderFrontMatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${cleanValue(value)}`);
  return [FENCE, ...lines, FENCE].join("\n");
}

/**
 * Returns `text` with the given fields changed or added inside its front-matter block.
 * Existing lines for other fields, and the body, are kept exactly as they were.
 * Failure: text without a block throws `ScoutError("invalid-input")`.
 */
export function patchFrontMatter(text: string, patch: Record<string, string>): string {
  const block = findBlock(text);
  if (block === undefined) {
    throw new ScoutError(
      "invalid-input",
      "This file has no front-matter block between two `---` lines, so Scout cannot update it.",
    );
  }
  const header = block.lines.slice(1, block.closingIndex);
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = normaliseKey(rawKey);
    const newLine = `${key}: ${cleanValue(rawValue)}`;
    const existingIndex = header.findIndex((line) => {
      const colonIndex = line.indexOf(":");
      return colonIndex > 0 && normaliseKey(line.slice(0, colonIndex)) === key;
    });
    if (existingIndex >= 0) {
      header[existingIndex] = newLine;
    } else {
      header.push(newLine);
    }
  }
  const rest = block.lines.slice(block.closingIndex + 1);
  return [FENCE, ...header, FENCE, ...rest].join("\n");
}
