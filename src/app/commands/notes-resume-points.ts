/**
 * Turns a resume's LaTeX source into the list of points the interview plan needs.
 *
 * Why it exists: `buildInterviewPlan` wants the resume points "exactly as sent", each with the
 * section it sat in and the employer or project above it. Scout's resumes come from one fixed
 * template, so the plain text made by `latexToText` has a known shape: upper-case section titles,
 * one header line per job or project, and `  - ` lines for points.
 *
 * Example: the text "EXPERIENCE\nSoftware Engineer, Harbor Systems (2023 – Present), Berlin\n  - Built an API."
 * gives `[{ section: "experience", heading: "Harbor Systems", text: "Built an API." }]`.
 */
import type { ResumePointSent } from "../../insight/index.js";
import { latexToText } from "../latex-to-text.js";

/** The text of a point line, or undefined when the line is not a point. */
function pointText(line: string): string | undefined {
  const match = /^\s+- (.+)$/.exec(line);
  return match?.[1]?.trim();
}

/**
 * The employer or project name from a header line.
 * Example: "Software Engineer, Harbor Systems (Jul 2023 – Present), Berlin" gives "Harbor Systems";
 * "Message Queue | Go, HTTP API | Code" gives "Message Queue".
 */
function headingOf(section: ResumePointSent["section"], line: string): string {
  if (section === "projects") return (line.split("|")[0] ?? line).trim();
  const afterTitle = line.includes(", ") ? line.slice(line.indexOf(", ") + 2) : line;
  return (afterTitle.split(" (")[0] ?? afterTitle).trim();
}

/**
 * Reads the experience and project points out of a resume's LaTeX source. Points in other
 * sections (summary, skills, education) are ignored. An unreadable source gives an empty list.
 */
export function resumePointsFromTex(texSource: string): ResumePointSent[] {
  const points: ResumePointSent[] = [];
  let section: ResumePointSent["section"] | undefined;
  let heading = "";
  for (const line of latexToText(texSource).split("\n")) {
    const text = pointText(line);
    if (text !== undefined) {
      if (section !== undefined) points.push({ section, heading, text });
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "EXPERIENCE") section = "experience";
    else if (trimmed === "PROJECTS") section = "projects";
    else if (trimmed !== "" && trimmed === trimmed.toUpperCase() && !trimmed.includes(" | ")) {
      section = undefined;
    } else if (section !== undefined && trimmed !== "") {
      heading = headingOf(section, trimmed);
    }
  }
  return points;
}
