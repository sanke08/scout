/**
 * Layered dedupe: finds postings that are the same job and merges them into one.
 *
 * Layer 1: identical canonical address. Layer 2: same company, title and location after
 * tidying. Layer 3: same company, a very similar title, and a description that shares most of
 * its three-word shingles. The merged posting keeps every source, and the official-board
 * version (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee) wins as canonical.
 */
import type { BoardKind, Posting, PostingSource } from "../shared/index.js";
import { FLAG_GHOST_SUSPECT, withFlags } from "./flags.js";

/** Description similarity (Jaccard of three-word shingles) at or above which two postings are the same job. */
export const DESCRIPTION_SIMILARITY_THRESHOLD = 0.8;

/** Title similarity (Jaccard of words) at or above which layer 3 may merge two postings. */
export const TITLE_SIMILARITY_THRESHOLD = 0.67;

/** Descriptions with fewer words than this are too short to compare for similarity. */
export const MIN_WORDS_FOR_SIMILARITY = 30;

/** Number of words in one shingle. */
const SHINGLE_SIZE = 3;

/** Boards run by applicant-tracking systems: tier A, trusted over feeds and others. */
const OFFICIAL_BOARDS: ReadonlySet<BoardKind> = new Set<BoardKind>([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "recruitee",
]);

/** Words in a company name that carry no identity: "Examplecorp Inc." and "Examplecorp" match. */
const COMPANY_SUFFIXES = new Set(["inc", "llc", "ltd", "gmbh", "corp", "co", "plc", "ag", "bv"]);

/** Short forms in titles mapped to the full word, so "Sr. Engineer" matches "Senior Engineer". */
const TITLE_WORD_FORMS: Record<string, string> = { sr: "senior", jr: "junior", eng: "engineer" };

/** Lower-cases text and keeps only letters, digits and single spaces. */
function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Returns the words of a company name without legal suffixes: "Harbor Systems, Inc." gives "harbor systems". */
export function normaliseCompany(company: string): string {
  return tidy(company)
    .split(" ")
    .filter((word) => !COMPANY_SUFFIXES.has(word))
    .join(" ");
}

/** Returns the words of a title with short forms expanded: "Sr. Backend Engineer" gives ["senior", "backend", "engineer"]. */
function titleWords(title: string): string[] {
  const withoutBrackets = title.replace(/\([^)]*\)/g, " ");
  return tidy(withoutBrackets)
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => TITLE_WORD_FORMS[word] ?? word);
}

/** Returns a location without punctuation and without country suffixes after a comma: "Berlin, Germany" gives "berlin". */
function normaliseLocation(location: string): string {
  const firstPart = location.split(/[,;]/)[0] ?? "";
  return tidy(firstPart);
}

/** The key for layer 2: company, title and location tidied and joined. */
export function sameJobKey(posting: Posting): string {
  return [
    normaliseCompany(posting.company),
    titleWords(posting.title).join(" "),
    normaliseLocation(posting.location),
  ].join("|");
}

/** Returns the set of consecutive three-word groups in some text. */
function shingles(text: string): Set<string> {
  const words = tidy(text).split(" ");
  const groups = new Set<string>();
  for (let start = 0; start + SHINGLE_SIZE <= words.length; start++) {
    groups.add(words.slice(start, start + SHINGLE_SIZE).join(" "));
  }
  return groups;
}

/** Jaccard similarity of two sets: size of the overlap divided by size of the union (0 to 1). */
function jaccard<Item>(first: ReadonlySet<Item>, second: ReadonlySet<Item>): number {
  if (first.size === 0 && second.size === 0) return 0;
  let overlap = 0;
  for (const item of first) {
    if (second.has(item)) overlap++;
  }
  return overlap / (first.size + second.size - overlap);
}

/**
 * How alike two descriptions are, from 0 (nothing shared) to 1 (identical wording).
 *
 * Example: the same text with one extra sentence scores about 0.9; unrelated texts score near 0.
 */
export function descriptionSimilarity(first: string, second: string): number {
  return jaccard(shingles(first), shingles(second));
}

/** Counts the words in some text. */
function wordCount(text: string): number {
  return tidy(text) === "" ? 0 : tidy(text).split(" ").length;
}

/** Layer 3 test: same company, similar title, and similar long-enough descriptions. */
function looksLikeSameText(first: Posting, second: Posting): boolean {
  if (normaliseCompany(first.company) !== normaliseCompany(second.company)) return false;
  if (
    jaccard(new Set(titleWords(first.title)), new Set(titleWords(second.title))) <
    TITLE_SIMILARITY_THRESHOLD
  ) {
    return false;
  }
  if (
    wordCount(first.description) < MIN_WORDS_FOR_SIMILARITY ||
    wordCount(second.description) < MIN_WORDS_FOR_SIMILARITY
  ) {
    return false;
  }
  return (
    descriptionSimilarity(first.description, second.description) >= DESCRIPTION_SIMILARITY_THRESHOLD
  );
}

/** Groups indexes of postings that are the same job, using the three layers. */
function groupSameJobs(postings: Posting[]): number[][] {
  const groupOf = postings.map((_posting, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (groupOf[root] !== root) root = groupOf[root] as number;
    return root;
  };
  const join = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot)
      groupOf[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot);
  };

  const firstByUrl = new Map<string, number>();
  const firstByKey = new Map<string, number>();
  postings.forEach((posting, index) => {
    const sameUrl = firstByUrl.get(posting.canonicalUrl);
    if (sameUrl === undefined) firstByUrl.set(posting.canonicalUrl, index);
    else join(sameUrl, index);

    const key = sameJobKey(posting);
    const sameKey = firstByKey.get(key);
    if (sameKey === undefined) firstByKey.set(key, index);
    else join(sameKey, index);
  });

  for (let first = 0; first < postings.length; first++) {
    for (let second = first + 1; second < postings.length; second++) {
      const firstPosting = postings[first] as Posting;
      const secondPosting = postings[second] as Posting;
      if (find(first) !== find(second) && looksLikeSameText(firstPosting, secondPosting))
        join(first, second);
    }
  }

  const groups = new Map<number, number[]>();
  postings.forEach((_posting, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  return [...groups.values()];
}

/** Picks the posting that should be canonical: an official board beats a feed; ties keep input order. */
function chooseCanonical(group: Posting[]): Posting {
  const official = group.find((posting) => OFFICIAL_BOARDS.has(posting.board));
  return official ?? (group[0] as Posting);
}

/** Merges the sources of several postings, dropping repeats of the same name and address. */
function mergeSources(group: Posting[]): PostingSource[] {
  const merged: PostingSource[] = [];
  for (const posting of group) {
    for (const source of posting.sources) {
      const known = merged.some((other) => other.name === source.name && other.url === source.url);
      if (!known) merged.push(source);
    }
  }
  return merged;
}

/** Returns the earliest of some ISO timestamps, or undefined when there are none. */
function earliest(timestamps: (string | undefined)[]): string | undefined {
  const present = timestamps.filter((timestamp) => timestamp !== undefined).sort();
  return present[0];
}

/**
 * Merges one group of same-job postings into one posting. Warning flags from the other copies
 * are kept, except the ghost flag: a short feed snippet says nothing about the official ad.
 */
function mergeGroup(group: Posting[]): Posting {
  const canonical = chooseCanonical(group);
  const postedAt = earliest(group.map((posting) => posting.postedAt));
  const salary = canonical.salary ?? group.find((posting) => posting.salary)?.salary;
  const merged: Posting = {
    ...canonical,
    ...(salary ? { salary } : {}),
    ...(postedAt ? { postedAt } : {}),
    firstSeenAt: earliest(group.map((posting) => posting.firstSeenAt)) ?? canonical.firstSeenAt,
    lastSeenAt:
      group
        .map((posting) => posting.lastSeenAt)
        .sort()
        .at(-1) ?? canonical.lastSeenAt,
    sources: mergeSources(group),
  };
  const flagsFromCopies = group
    .filter((posting) => posting !== canonical)
    .flatMap((posting) => posting.flags)
    .filter((flag) => flag !== FLAG_GHOST_SUSPECT);
  return withFlags(merged, flagsFromCopies);
}

/**
 * Merges postings that are the same job, keeping first-appearance order of the groups.
 *
 * Example: the same "Senior Backend Engineer" read from a Greenhouse board, a Lever board and
 * three feeds comes back as one posting with five sources and the Greenhouse address as
 * `canonicalUrl`. Different jobs of one company stay separate.
 * Failure: never throws; an empty list gives an empty list.
 */
export function dedupePostings(postings: Posting[]): Posting[] {
  return groupSameJobs(postings).map((indexes) =>
    mergeGroup(indexes.map((index) => postings[index] as Posting)),
  );
}
