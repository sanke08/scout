/**
 * Renders a verified note as the Markdown file format defined in `src/profile/README.md`.
 *
 * Why: the profile module reads notes with a plain parser. The output here must be exactly that
 * format, and no text from the model may add a heading or a bullet of its own, so every value is
 * cleaned to one line before it is written.
 */
import { toOneLine } from "./text-match.js";
import type { ProjectNoteReply } from "./note-schema.js";

/** The verdict words as written in the note. */
const VERDICT_LABELS: Readonly<Record<ProjectNoteReply["verdict"]["kind"], string>> = {
  "real project": "Real project",
  "tutorial copy": "Tutorial copy",
  demo: "Demo",
  unfinished: "Unfinished",
};

/** Cleans one stack term: one line, and no comma (the parser splits stack lines on commas). */
function cleanStackTerm(term: string): string {
  return toOneLine(term.replace(/,/g, " "));
}

/** Renders one feature as a bullet with indented continuation lines the parser joins back up. */
function renderFeature(feature: ProjectNoteReply["features"][number]): string[] {
  const lines = [
    `- ${toOneLine(feature.name)} (${feature.status}): ${toOneLine(feature.howItWorks)}`,
  ];
  const decisions = feature.designDecisions.map(toOneLine).filter((text) => text !== "");
  if (decisions.length > 0) {
    lines.push(`  Design decisions: ${decisions.join("; ")}`);
  }
  const failure = toOneLine(feature.failureHandling);
  if (failure !== "") {
    lines.push(`  Failure handling: ${failure}`);
  }
  return lines;
}

/**
 * Renders the note.
 *
 * The first line is `# Title`; then the five fixed sections the profile parser reads (Overview,
 * Verdict, Stack, Features, Do not claim); then two sections the parser ignores and people read:
 * "Numbers" (real figures with what they measure) and "Read once" (the folder name and date).
 *
 * `readOn` is an ISO date such as "2026-11-07"; `folderName` is the repository folder's name,
 * never a full path.
 */
export function renderNoteMarkdown(
  note: ProjectNoteReply,
  folderName: string,
  readOn: string,
): string {
  const lines: string[] = [
    `# ${toOneLine(note.title)}`,
    "",
    "## Overview",
    "",
    toOneLine(note.overview),
  ];
  lines.push(
    "",
    "## Verdict",
    "",
    `${VERDICT_LABELS[note.verdict.kind]}. ${toOneLine(note.verdict.reason)}`,
  );
  lines.push("", "## Stack", "");
  for (const term of note.stack.map(cleanStackTerm).filter((text) => text !== "")) {
    lines.push(`- ${term}`);
  }
  lines.push("", "## Features", "");
  for (const feature of note.features) {
    lines.push(...renderFeature(feature));
  }
  lines.push("", "## Do not claim", "");
  for (const statement of note.doNotClaim) {
    lines.push(`- ${toOneLine(statement)}`);
  }
  lines.push("", "## Numbers", "");
  if (note.numbers.length === 0) {
    lines.push("None found in the configuration or code.");
  }
  for (const entry of note.numbers) {
    lines.push(`- ${toOneLine(entry.figure)}: ${toOneLine(entry.meaning)}`);
  }
  lines.push(
    "",
    "## Read once",
    "",
    `Read from the folder ${toOneLine(folderName)} on ${readOn}.`,
    "",
  );
  return lines.join("\n");
}
