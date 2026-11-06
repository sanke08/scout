/**
 * The resume builder: turns the profile and one job's keywords into a one-page resume.
 *
 * No model is called. The only text on the page is text the user stored or approved (a point's
 * base wording or one of its alternate wordings). A job keyword the profile does not support is
 * reported and never added.
 */
import type {
  Profile,
  ProjectEntry,
  ResumeBuild,
  ResumeBuilder,
  SkillRow,
} from "../shared/index.js";
import { estimateLines, LINE_LIMIT } from "./estimate.js";
import { containsWholeWord, normalizeKeywords } from "./keywords.js";
import { renderLatex } from "./latex.js";
import type { ModelExperience, ModelProject, ResumeModel } from "./model.js";
import { isUsablePoint, orderSkillRows, rankProjects, selectPoints } from "./selection.js";
import type { RankedProject } from "./selection.js";
import { chooseWording } from "./wording.js";

/** Most points shown for one job. */
const POINTS_PER_JOB = 4;

/** Points shown for one project. */
const POINTS_PER_PROJECT = 3;

/** Projects always shown when the profile has them, whatever the estimate says. */
const MINIMUM_PROJECTS = 3;

/** Most projects ever shown. */
const MAXIMUM_PROJECTS = 5;

/** The jobs of the resume in stored order, each with its chosen points. A job is never dropped. */
function buildExperience(profile: Profile, keywords: readonly string[]): ModelExperience[] {
  const jobs: ModelExperience[] = [];
  for (const entry of profile.experience) {
    if (entry.title === "") continue;
    const chosen = selectPoints(entry.points, POINTS_PER_JOB, keywords);
    jobs.push({
      title: entry.title,
      org: entry.org,
      dates: entry.dates,
      place: entry.place,
      points: chosen.map((point) => point.wording.text),
    });
  }
  return jobs;
}

/** Turns a ranked project into the model's project, using the chosen wording of its points. */
function toModelProject(ranked: RankedProject): ModelProject {
  const project: ProjectEntry = ranked.project;
  return {
    title: project.title,
    stack: project.stack,
    ...(project.link === undefined ? {} : { link: project.link }),
    ...(project.live === undefined ? {} : { live: project.live }),
    ...(project.note === undefined ? {} : { note: project.note }),
    points: ranked.points.map((point) => point.wording.text),
  };
}

/** What `chooseProjects` decided. */
interface ProjectChoice {
  shown: ModelProject[];
  leftOut: string[];
}

/**
 * Adds projects in rank order. The first three are always added; a fourth or fifth is added only
 * if the page-fit estimate still fits, and a project that does not fit is left out while a later,
 * shorter one may still be tried. No more than five are ever shown.
 */
function chooseProjects(
  ranked: readonly RankedProject[],
  modelWithoutProjects: ResumeModel,
): ProjectChoice {
  const shown: ModelProject[] = [];
  const leftOut: string[] = [];
  for (const candidate of ranked) {
    if (shown.length >= MAXIMUM_PROJECTS) {
      leftOut.push(candidate.project.title);
      continue;
    }
    shown.push(toModelProject(candidate));
    const fits = estimateLines({ ...modelWithoutProjects, projects: shown }) <= LINE_LIMIT;
    if (shown.length > MINIMUM_PROJECTS && !fits) {
      shown.pop();
      leftOut.push(candidate.project.title);
    }
  }
  return { shown, leftOut };
}

/** True when some skills row holds the keyword as a whole word. */
function skillsHold(rows: readonly SkillRow[], keyword: string): boolean {
  return rows.some((row) => containsWholeWord(row.items.join(", "), keyword));
}

/**
 * Splits the job keywords into those the profile supports and those it does not.
 *
 * A keyword is supported when it is one of the `allowed` terms of a usable point, appears as a
 * whole word in the wording chosen for a usable point or for the summary, or is in a skills row.
 * Held, excluded and ask-first points support nothing.
 */
function splitKeywords(
  profile: Profile,
  keywords: readonly string[],
  summaryMatches: readonly string[],
): { matched: string[]; notInProfile: string[] } {
  const supported = new Set<string>(summaryMatches);
  const points = [
    ...profile.experience.flatMap((entry) => entry.points),
    ...profile.projects.flatMap((project) => project.points),
  ];
  for (const point of points) {
    if (isUsablePoint(point)) {
      for (const keyword of chooseWording(point, keywords).matchedKeywords) {
        supported.add(keyword);
      }
    }
  }
  const matched: string[] = [];
  const notInProfile: string[] = [];
  for (const keyword of keywords) {
    if (supported.has(keyword) || skillsHold(profile.skills, keyword)) {
      matched.push(keyword);
    } else {
      notInProfile.push(keyword);
    }
  }
  return { matched, notInProfile };
}

/**
 * The file name stem: the person's name with runs of other characters turned into one underscore,
 * then the company with every other character removed.
 *
 * Example: ("Alex Rivera", "Example Corp.") gives `Alex_Rivera_ExampleCorp`; no company gives
 * `Alex_Rivera_Company`.
 */
function buildFileStem(name: string, company: string | undefined): string {
  const namePart = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Resume";
  const companyPart = (company ?? "").replace(/[^A-Za-z0-9]/g, "") || "Company";
  return `${namePart}_${companyPart}`;
}

/**
 * Builds the resume for one job.
 *
 * `keywords` are the job's keywords as written (any case, duplicates allowed). With none, every
 * point keeps its stored wording. The same inputs always give the same result.
 */
function buildResume(
  profile: Profile,
  keywords: string[],
  options?: { company?: string },
): ResumeBuild {
  const cleanKeywords = normalizeKeywords(keywords);
  const summary = chooseWording({ ...profile.summary, allowed: [] }, cleanKeywords);
  const modelWithoutProjects: ResumeModel = {
    identity: profile.identity,
    education: profile.education,
    summary: summary.text,
    skills: orderSkillRows(profile.skills, cleanKeywords),
    experience: buildExperience(profile, cleanKeywords),
    projects: [],
  };
  const ranked = rankProjects(profile.projects, POINTS_PER_PROJECT, cleanKeywords);
  const choice = chooseProjects(ranked, modelWithoutProjects);
  const model: ResumeModel = { ...modelWithoutProjects, projects: choice.shown };
  const keywordSplit = splitKeywords(profile, cleanKeywords, summary.matchedKeywords);

  return {
    texSource: renderLatex(model),
    estimatedLines: estimateLines(model),
    lineLimit: LINE_LIMIT,
    projectsShown: choice.shown.map((project) => project.title),
    projectsLeftOut: choice.leftOut,
    matchedKeywords: keywordSplit.matched,
    notInProfile: keywordSplit.notInProfile,
    fileStem: buildFileStem(profile.identity.name, options?.company),
  };
}

/**
 * Creates the resume builder (the `ResumeBuilder` port). It holds no state, so one instance can
 * build any number of resumes.
 *
 * Example: `createResumeBuilder().build(profile, ["TypeScript", "Kafka"], { company: "Example Corp" })`
 * returns the LaTeX source, the projects shown, and any keyword the profile does not support.
 */
export function createResumeBuilder(): ResumeBuilder {
  return { build: buildResume };
}
