/**
 * Writing the complete LaTeX source of the resume from a `ResumeModel`.
 *
 * The preamble is the fixed template. Only the lines after `\begin{document}` are written here,
 * and the stretchable `\vspace{... plus ...fill ...}` gaps are copied exactly as in the template,
 * because they are what make the page fill itself.
 */
import type { Identity } from "../shared/index.js";
import { escapeHref, escapeLatex, linkDisplay, linkTarget } from "./escape.js";
import type { ModelProject, ResumeModel } from "./model.js";
import { LATEX_PREAMBLE } from "./preamble.js";

/** The separator printed between contact details. */
const CONTACT_SEPARATOR = " $|$ ";

/**
 * A blue clickable link whose visible text has no protocol and no `www.`.
 * Example: `linkCommand("github.com/example-alex")` gives
 * `\href{https://github.com/example-alex}{\textcolor{blue}{github.com/example-alex}}`.
 */
function linkCommand(address: string): string {
  const target = escapeHref(linkTarget(address));
  return `\\href{${target}}{\\textcolor{blue}{${escapeLatex(linkDisplay(address))}}}`;
}

/** The email as a blue `mailto:` link. Example: `alex@example.com` becomes a clickable address. */
function emailCommand(email: string): string {
  return `\\href{mailto:${escapeHref(email)}}{\\textcolor{blue}{${escapeLatex(email)}}}`;
}

/**
 * The name and contact block. Missing contact fields are dropped together with their separators,
 * and a whole line is dropped when none of its fields exist.
 */
function headingLines(identity: Identity): string[] {
  const firstLine: string[] = [];
  if (identity.location !== "") firstLine.push(escapeLatex(identity.location));
  if (identity.phone) firstLine.push(escapeLatex(identity.phone));
  if (identity.email) firstLine.push(emailCommand(identity.email));
  const secondLine = [identity.github, identity.linkedin, identity.portfolio]
    .filter((address): address is string => address !== undefined && address !== "")
    .map(linkCommand);

  const lines = [
    "%----------HEADING----------",
    "\\begin{center}",
    `  {\\Huge \\scshape ${escapeLatex(identity.name)}} \\\\ \\vspace{4pt}`,
  ];
  if (firstLine.length > 0) {
    lines.push(`  \\small ${firstLine.join(CONTACT_SEPARATOR)} \\\\ \\vspace{2pt}`);
  }
  if (secondLine.length > 0) {
    lines.push(`  \\small ${secondLine.join(`${CONTACT_SEPARATOR}\n  `)}`);
  }
  lines.push("\\end{center}", "\\vspace{-4pt plus 3fill}");
  return lines;
}

/** The summary section; empty when the summary has no text. */
function summaryLines(summary: string): string[] {
  if (summary.trim() === "") return [];
  return [
    "%-----------SUMMARY-----------",
    "\\section{Summary}",
    `\\small{${escapeLatex(summary)}}`,
    "\\vspace{8pt plus 3fill minus 4pt}",
    "",
  ];
}

/** The skills section; empty when there are no rows (an empty list would not compile). */
function skillsLines(model: ResumeModel): string[] {
  if (model.skills.length === 0) return [];
  const lines = [
    "%-----------TECHNICAL SKILLS-----------",
    "\\section{Technical Skills}",
    "\\begin{itemize}[leftmargin=0.15in, label={}]",
    "    \\small{",
    "    \\item{",
  ];
  for (const row of model.skills) {
    lines.push(
      `        \\textbf{${escapeLatex(row.label)}}{: ${escapeLatex(row.items.join(", "))}} \\\\`,
    );
  }
  lines.push("    }}", "\\end{itemize}", "\\vspace{1pt plus 3fill minus 4pt}", "");
  return lines;
}

/** The bullet list of one entry; empty when the entry has no points (an empty list would not compile). */
function bulletLines(points: readonly string[]): string[] {
  if (points.length === 0) return [];
  return [
    "\\resumeItemListStart",
    ...points.map((point) => `\\resumeItem{${escapeLatex(point)}}`),
    "\\resumeItemListEnd",
  ];
}

/** The experience section; empty when there is no job. */
function experienceLines(model: ResumeModel): string[] {
  if (model.experience.length === 0) return [];
  const lines = [
    "%-----------EXPERIENCE-----------",
    "\\section{Experience}",
    "\\resumeSubHeadingListStart",
  ];
  for (const job of model.experience) {
    lines.push(
      "",
      "\\resumeSubheading",
      `{${escapeLatex(job.title)}}{${escapeLatex(job.dates)}}`,
      `{${escapeLatex(job.org)}}{${escapeLatex(job.place)}}`,
      ...bulletLines(job.points),
    );
  }
  lines.push("", "\\resumeSubHeadingListEnd", "\\vspace{-4pt plus 2fill minus 2pt}", "");
  return lines;
}

/** The heading line of a project: bold title, stack, Live and Code links, optional note. */
function projectHeading(project: ModelProject): string {
  const parts = [`\\textbf{${escapeLatex(project.title)}}`];
  if (project.stack !== "") parts.push(`\\emph{${escapeLatex(project.stack)}}`);
  if (project.live) {
    parts.push(`\\href{${escapeHref(linkTarget(project.live))}}{\\underline{Live}}`);
  }
  if (project.link) {
    parts.push(`\\href{${escapeHref(linkTarget(project.link))}}{\\underline{Code}}`);
  }
  if (project.note) parts.push(`\\emph{${escapeLatex(project.note)}}`);
  return parts.join(CONTACT_SEPARATOR);
}

/** The projects section; empty when there is no project. */
function projectsLines(model: ResumeModel): string[] {
  if (model.projects.length === 0) return [];
  const lines = [
    "%-----------PROJECTS-----------",
    "\\section{Projects}",
    "\\resumeSubHeadingListStart",
  ];
  for (const project of model.projects) {
    lines.push(
      "",
      "\\resumeProjectHeading",
      `{${projectHeading(project)}}{}`,
      ...bulletLines(project.points),
    );
  }
  lines.push("", "\\resumeSubHeadingListEnd", "\\vspace{-1pt plus 2fill minus 2pt}");
  return lines;
}

/** The education section. */
function educationLines(model: ResumeModel): string[] {
  const education = model.education;
  return [
    "%-----------EDUCATION-----------",
    "\\section{Education}",
    "\\resumeSubHeadingListStart",
    "\\resumeSubheading",
    `{${escapeLatex(education.degree)}}{${escapeLatex(education.dates)}}`,
    `{${escapeLatex(education.school)}}{${escapeLatex(education.grade)}}`,
    "\\resumeSubHeadingListEnd",
    "",
    "%-------------------------------------------",
    "\\end{document}",
  ];
}

/**
 * Writes the complete LaTeX source: the fixed preamble, a blank line, then the sections in the
 * fixed order (contact, summary, skills, experience, projects, education). A section with nothing
 * to show is left out, because an empty list does not compile.
 *
 * Example: `renderLatex(model)` returns text that starts with `\documentclass` and ends with
 * `\end{document}` and a newline.
 */
export function renderLatex(model: ResumeModel): string {
  const body = [
    ...headingLines(model.identity),
    ...summaryLines(model.summary),
    ...skillsLines(model),
    ...experienceLines(model),
    ...projectsLines(model),
    ...educationLines(model),
  ];
  return `${LATEX_PREAMBLE}\n${body.join("\n")}\n`;
}
