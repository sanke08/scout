/**
 * The resume after selection and wording, before it is turned into LaTeX.
 *
 * Keeping this step separate lets the page-fit estimate and the LaTeX writer read the same
 * plain data, and lets tests look at what was chosen without parsing LaTeX.
 */
import type { Education, Identity } from "../shared/index.js";

/** One skills row as it will print, e.g. label "Languages", items ["Go", "TypeScript"]. */
export interface ModelSkillRow {
  label: string;
  items: string[];
}

/** One job with the wording chosen for each of its points. */
export interface ModelExperience {
  title: string;
  org: string;
  dates: string;
  place: string;
  points: string[];
}

/** One project with the wording chosen for each of its points. */
export interface ModelProject {
  title: string;
  stack: string;
  link?: string;
  live?: string;
  note?: string;
  points: string[];
}

/**
 * Everything the resume will show, as plain text (not yet escaped for LaTeX).
 * Example: `{ summary: "Software Engineer ...", skills: [...], experience: [...], ... }`.
 */
export interface ResumeModel {
  identity: Identity;
  education: Education;
  summary: string;
  skills: ModelSkillRow[];
  experience: ModelExperience[];
  projects: ModelProject[];
}
