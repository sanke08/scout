/**
 * Deciding which points, projects and skill items appear on the resume for one job.
 *
 * Selection decides what appears, never the order of points: stored order is always kept.
 */
import { USABLE_POINT_STATUSES } from "../shared/index.js";
import type { Point, ProjectEntry, SkillRow } from "../shared/index.js";
import { containsTerm } from "./keywords.js";
import { chooseWording } from "./wording.js";
import type { ChosenWording } from "./wording.js";

/** A point that was chosen, with where it sat in the entry and the wording picked for it. */
export interface SelectedPoint {
  /** Position in the entry's stored list of points. */
  storedIndex: number;
  wording: ChosenWording;
}

/** A project with its chosen points and its total match, ready for ranking. */
export interface RankedProject {
  project: ProjectEntry;
  /** Position in the profile's stored list of projects. */
  storedIndex: number;
  points: SelectedPoint[];
  /** Sum over the chosen points of the keywords each supports. Higher means more relevant. */
  totalMatch: number;
}

/** A skills row with its items reordered for the job. */
export interface OrderedSkillRow {
  label: string;
  items: string[];
}

/**
 * True when a point may be used without asking: confirmed or from code, and with some text.
 * Held, excluded and ask-first points are never usable.
 *
 * Example: a point with status "hold" gives false.
 */
export function isUsablePoint(point: Point): boolean {
  return USABLE_POINT_STATUSES.includes(point.status) && point.text.trim() !== "";
}

/**
 * Chooses up to `limit` points of one entry for the job.
 *
 * The first usable point is the entry's headline and is always kept. The remaining places go to
 * the points that support the most job keywords (earlier points win ties). The result is in
 * stored order.
 *
 * Example: four usable points, limit 3, the headline matches nothing, the third and fourth match
 * most: the result holds points 1, 3 and 4 (as stored positions 0, 2, 3).
 * An entry with no usable points gives an empty list.
 */
export function selectPoints(
  points: readonly Point[],
  limit: number,
  keywords: readonly string[],
): SelectedPoint[] {
  const candidates: SelectedPoint[] = [];
  points.forEach((point, storedIndex) => {
    if (isUsablePoint(point)) {
      candidates.push({ storedIndex, wording: chooseWording(point, keywords) });
    }
  });
  const headline = candidates[0];
  if (headline === undefined || limit < 1) {
    return [];
  }
  const others = candidates
    .slice(1)
    .sort(
      (a, b) =>
        b.wording.matchedKeywords.length - a.wording.matchedKeywords.length ||
        a.storedIndex - b.storedIndex,
    )
    .slice(0, limit - 1);
  return [headline, ...others].sort((a, b) => a.storedIndex - b.storedIndex);
}

/**
 * Ranks projects for the job, most relevant first. Each project is scored on its own chosen
 * points; equal scores keep the stored order. Projects without a title are ignored.
 *
 * Example: with keywords ["go"], a project whose three points mention Go twice outranks one that
 * mentions it never.
 */
export function rankProjects(
  projects: readonly ProjectEntry[],
  pointsPerProject: number,
  keywords: readonly string[],
): RankedProject[] {
  const ranked: RankedProject[] = [];
  projects.forEach((project, storedIndex) => {
    if (project.title === "") {
      return;
    }
    const points = selectPoints(project.points, pointsPerProject, keywords);
    const totalMatch = points.reduce((sum, point) => sum + point.wording.matchedKeywords.length, 0);
    ranked.push({ project, storedIndex, points, totalMatch });
  });
  return ranked.sort((a, b) => b.totalMatch - a.totalMatch || a.storedIndex - b.storedIndex);
}

/**
 * Orders the skill rows and their items for the job. Inside a row, items that equal a job keyword
 * come first. Rows with more such items come first. A row labelled "Languages" is always first.
 * All sorting is stable, so unmatched items and rows keep their stored order.
 *
 * Example: keywords ["kafka"], row "Data" with items ["PostgreSQL", "Kafka"] gives the items
 * ["Kafka", "PostgreSQL"].
 */
export function orderSkillRows(
  rows: readonly SkillRow[],
  keywords: readonly string[],
): OrderedSkillRow[] {
  const scored = rows.map((row) => {
    const matched = row.items.filter((item) => containsTerm(keywords, item.toLowerCase()));
    const rest = row.items.filter((item) => !containsTerm(keywords, item.toLowerCase()));
    return { label: row.label, items: [...matched, ...rest], score: matched.length };
  });
  scored.sort((a, b) => b.score - a.score);
  const isLanguages = (label: string): number => (/^languages$/i.test(label) ? 0 : 1);
  scored.sort((a, b) => isLanguages(a.label) - isLanguages(b.label));
  return scored.map((row) => ({ label: row.label, items: row.items }));
}
