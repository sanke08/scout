/**
 * Guessing how full the one-page resume is, without compiling it.
 *
 * The numbers were calibrated against a real one-page resume: an estimate of 76.3 lines fitted one
 * page and 77.3 did not. It is a guide only; the real check is the page count after compiling.
 */
import type { ResumeModel } from "./model.js";

/**
 * The largest estimate still treated as fitting on one page.
 * Example: an estimate of 76.3 fits; 77.3 does not.
 */
export const LINE_LIMIT = 76.5;

/** Characters that fit on one line of the summary and of a skills row. */
const CHARACTERS_PER_WIDE_LINE = 125;

/** Characters that fit on one line of a bullet (it is indented). */
const CHARACTERS_PER_BULLET_LINE = 118;

/** Extra space after each bullet, in lines. */
const BULLET_GAP = 0.25;

/** Space taken by a section heading with its rule and gap, in lines. */
const SECTION_HEADING = 1.8;

/** Height of the name and contact block, in lines. */
const HEADER_BLOCK = 3.6;

/** Height of a job's title row plus its company row and gap, in lines. */
const EXPERIENCE_HEADING = 2.3;

/** Height of a project's heading row, in lines. */
const PROJECT_HEADING = 1.4;

/** Height of the education block (heading row and school row), in lines. */
const EDUCATION_ROWS = 2.3;

/**
 * Number of lines a text takes when each line holds `charactersPerLine`; at least one.
 * Example: `linesFor("a".repeat(130), 125)` is 2.
 */
function linesFor(text: string, charactersPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charactersPerLine));
}

/** Lines taken by a list of bullets, including the small gap after each. */
function bulletLines(points: readonly string[]): number {
  let lines = 0;
  for (const point of points) {
    lines += linesFor(point, CHARACTERS_PER_BULLET_LINE) + BULLET_GAP;
  }
  return lines;
}

/**
 * Estimates the length of the resume in lines, rounded to one decimal.
 *
 * Text lengths are measured before LaTeX escaping. Compare the result with `LINE_LIMIT`.
 * Example: a short resume with a one-line summary, four skills rows, two jobs of three bullets and
 * three projects of three bullets comes out near 65.
 */
export function estimateLines(model: ResumeModel): number {
  let lines = HEADER_BLOCK + SECTION_HEADING + linesFor(model.summary, CHARACTERS_PER_WIDE_LINE);
  lines += SECTION_HEADING;
  for (const row of model.skills) {
    const rowText = `${row.label}: ${row.items.join(", ")}`;
    lines += linesFor(rowText, CHARACTERS_PER_WIDE_LINE);
  }
  lines += SECTION_HEADING;
  for (const job of model.experience) {
    lines += EXPERIENCE_HEADING + bulletLines(job.points);
  }
  lines += SECTION_HEADING;
  for (const project of model.projects) {
    lines += PROJECT_HEADING + bulletLines(project.points);
  }
  lines += SECTION_HEADING + EDUCATION_ROWS;
  return Math.round(lines * 10) / 10;
}
