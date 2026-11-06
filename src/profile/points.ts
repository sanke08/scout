/**
 * Pure helpers for the points of a profile: which are usable, what terms the profile claims,
 * and how to add, change or remove a point or an alternate wording.
 *
 * Every function returns a new profile and leaves its input untouched, so a caller can keep the
 * old one for comparison. None of them saves anything or changes `version`; saving does that.
 *
 * Example: `addVariant(profile, address, variant)` returns a copy of `profile` in which that one
 * point has one more alternate wording.
 */
import {
  USABLE_POINT_STATUSES,
  ScoutError,
  type ExperienceEntry,
  type Point,
  type PointStatus,
  type Profile,
  type ProjectEntry,
  type Variant,
} from "../shared/index.js";

/** Which list of entries a point lives in: the work history or the projects. */
export type EntrySection = "experience" | "projects";

/**
 * Names one job or one project by its position.
 * Example: `{ section: "projects", entryIndex: 1 }` is the second project.
 */
export interface EntryAddress {
  section: EntrySection;
  entryIndex: number;
}

/**
 * Names one point by its position.
 * Example: `{ section: "experience", entryIndex: 0, pointIndex: 2 }` is the third point of the
 * first job. An index that does not exist makes the helpers throw `invalid-input`.
 */
export interface PointAddress extends EntryAddress {
  pointIndex: number;
}

/**
 * Keeps only the points a resume may use without asking.
 *
 * Input: points with statuses `confirmed`, `hold`, `excluded`. Output: only the `confirmed` one.
 * `hold`, `excluded` and `ask first` points are never returned.
 */
export function usablePoints(entryPoints: readonly Point[]): Point[] {
  return entryPoints.filter((point) => USABLE_POINT_STATUSES.includes(point.status));
}

/** Lower-cases and trims a term so "Kafka " and "kafka" count as the same term. */
function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Every term the profile claims: all skill-row items and every point's `allowed` list,
 * lower-cased, without duplicates, in the order first met. Empty terms are dropped.
 *
 * Example: skills `["Go"]` and a point allowing `["go", "Kafka"]` give `["go", "kafka"]`.
 * Held and excluded points count too, because this answers "what is written in the profile",
 * not "what may a resume use".
 */
export function termsOfProfile(profile: Profile): string[] {
  const seen = new Set<string>();
  const add = (term: string): void => {
    const normalized = normalizeTerm(term);
    if (normalized !== "") {
      seen.add(normalized);
    }
  };
  for (const row of profile.skills) {
    row.items.forEach(add);
  }
  for (const entry of [...profile.experience, ...profile.projects]) {
    for (const point of entry.points) {
      point.allowed.forEach(add);
    }
  }
  return [...seen];
}

/**
 * Lists the keys of a variant that are not in the point's `allowed` list (case-insensitive).
 *
 * Example: allowed `["Go"]`, keys `["go", "Kafka"]` gives `["Kafka"]`.
 */
function keysOutsideAllowed(point: Point, variant: Variant): string[] {
  const allowed = new Set(point.allowed.map(normalizeTerm));
  return variant.keys.filter((key) => !allowed.has(normalizeTerm(key)));
}

/**
 * True when every key of the variant is one of the point's `allowed` terms (ignoring case).
 *
 * A variant is a rewording of the same fact for jobs that use certain words; it may not bring in
 * a technology the user has not confirmed for that point. Example: point allows `["React"]`;
 * a variant with keys `["React"]` is fine, one with keys `["React", "Kafka"]` is not.
 * An alias a job uses (such as "DLQ") must be added to `allowed` first, on purpose.
 */
export function variantUsesOnlyAllowedTerms(point: Point, variant: Variant): boolean {
  return keysOutsideAllowed(point, variant).length === 0;
}

/**
 * Throws `invalid-input` naming the terms when any variant of the point breaks the rule above.
 * A point with no variants always passes.
 */
function assertVariantsAllowed(point: Point): void {
  point.variants.forEach((variant, variantIndex) => {
    const outside = keysOutsideAllowed(point, variant);
    if (outside.length > 0) {
      throw new ScoutError(
        "invalid-input",
        `The alternate wording number ${variantIndex + 1} of the point "${point.text}" uses ${outside.join(", ")}, which the point does not list as allowed. Add the term to the point's allowed list first if it is true, or remove it from the wording.`,
      );
    }
  });
}

/**
 * Returns a copy of `items` where the item at `index` is replaced by `change(item)`.
 * Throws `invalid-input` with `what` in the sentence when the index does not exist.
 */
function replaceAt<Item>(
  items: readonly Item[],
  index: number,
  what: string,
  change: (item: Item) => Item,
): Item[] {
  const item = items[index];
  if (!Number.isInteger(index) || item === undefined) {
    throw new ScoutError(
      "invalid-input",
      `There is no ${what} at position ${index}; positions start at 0 and the list has ${items.length} item(s).`,
    );
  }
  return items.map((existing, position) => (position === index ? change(item) : existing));
}

/** Returns a copy of `items` without the item at `index`; throws `invalid-input` if none there. */
function removeAt<Item>(items: readonly Item[], index: number, what: string): Item[] {
  replaceAt(items, index, what, (item) => item);
  return items.filter((_, position) => position !== index);
}

/**
 * Returns a copy of the profile where the points of one job or project are replaced by
 * `change(points)`. Throws `invalid-input` when the job or project does not exist.
 */
function changePointsOfEntry(
  profile: Profile,
  address: EntryAddress,
  change: (points: Point[]) => Point[],
): Profile {
  if (address.section === "experience") {
    const experience = replaceAt(
      profile.experience,
      address.entryIndex,
      "job",
      (entry: ExperienceEntry) => ({ ...entry, points: change(entry.points) }),
    );
    return { ...profile, experience };
  }
  const projects = replaceAt(
    profile.projects,
    address.entryIndex,
    "project",
    (entry: ProjectEntry) => ({ ...entry, points: change(entry.points) }),
  );
  return { ...profile, projects };
}

/**
 * Returns a copy of the profile where one point is replaced by `change(point)`.
 * Throws `invalid-input` when the job, project or point does not exist.
 */
function changePoint(
  profile: Profile,
  address: PointAddress,
  change: (point: Point) => Point,
): Profile {
  return changePointsOfEntry(profile, address, (points) =>
    replaceAt(points, address.pointIndex, "point", change),
  );
}

/**
 * Adds a point at the end of one job or project.
 *
 * Throws `invalid-input` when that job or project does not exist, or when one of the new
 * point's alternate wordings uses a term outside its `allowed` list.
 */
export function addPoint(profile: Profile, entry: EntryAddress, point: Point): Profile {
  assertVariantsAllowed(point);
  return changePointsOfEntry(profile, entry, (points) => [...points, point]);
}

/**
 * Replaces the point at the address with a new version of it (text, terms, variants, status).
 *
 * Throws `invalid-input` when the address does not exist or when an alternate wording of the new
 * point uses a term outside its `allowed` list (for example after removing a term from `allowed`
 * that a variant still needs).
 */
export function updatePoint(profile: Profile, address: PointAddress, point: Point): Profile {
  assertVariantsAllowed(point);
  return changePoint(profile, address, () => point);
}

/** Removes the point at the address. Throws `invalid-input` when the address does not exist. */
export function removePoint(profile: Profile, address: PointAddress): Profile {
  return changePointsOfEntry(profile, address, (points) =>
    removeAt(points, address.pointIndex, "point"),
  );
}

/**
 * Adds an alternate wording at the end of the point's variants.
 *
 * Throws `invalid-input` when the address does not exist or when the variant's keys include a
 * term that is not in the point's `allowed` list; the profile is then not changed.
 */
export function addVariant(profile: Profile, address: PointAddress, variant: Variant): Profile {
  return changePoint(profile, address, (point) => {
    const changed = { ...point, variants: [...point.variants, variant] };
    assertVariantsAllowed(changed);
    return changed;
  });
}

/**
 * Removes the alternate wording at `variantIndex` of the point at the address.
 * Throws `invalid-input` when the address or the variant position does not exist.
 */
export function removeVariant(
  profile: Profile,
  address: PointAddress,
  variantIndex: number,
): Profile {
  return changePoint(profile, address, (point) => ({
    ...point,
    variants: removeAt(point.variants, variantIndex, "alternate wording"),
  }));
}

/**
 * Sets the status of one point, for example `confirmed` to `hold`.
 * Throws `invalid-input` when the address does not exist.
 */
export function setPointStatus(
  profile: Profile,
  address: PointAddress,
  status: PointStatus,
): Profile {
  return changePoint(profile, address, (point) => ({ ...point, status }));
}
