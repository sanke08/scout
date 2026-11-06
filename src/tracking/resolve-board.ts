/**
 * Finds the company's own job board for a job seen in a platform alert.
 *
 * Why it exists: Scout applies only through official boards. A job that appears in an alert is
 * most useful once it is tied to the company's own board, where it joins the normal flow. If the
 * company's board cannot be found, the job stays in the digest marked "platform-only".
 *
 * Nothing here fetches a web page. The caller supplies a lookup (for example Scout's list of
 * target companies) that returns a careers address for a company name; this module only decides
 * what board that address belongs to.
 *
 * Example: a lookup that answers "https://boards.greenhouse.io/northwindlabs" for "Northwind Labs"
 * gives `{ status: "resolved", board: { kind: "greenhouse", token: "northwindlabs" }, ... }`.
 */
import type { Posting } from "../shared/index.js";
import { detectBoard, type DetectedBoard } from "../discovery/index.js";
import type { PartialPosting } from "./alert-parsers.js";
import { titleWords } from "./words.js";

/** Returns the company's careers address, or undefined when it is not known. May be asynchronous. */
export type BoardLookup = (companyName: string) => Promise<string | undefined> | string | undefined;

/** The answer of `resolveToOfficialBoard`. */
export type BoardResolution =
  | { status: "resolved"; board: DetectedBoard; careersUrl: string }
  | { status: "platform-only"; reason: string };

/**
 * Asks `boardLookup` for the company's careers address and detects the board it belongs to.
 *
 * Returns `platform-only` with a plain reason when the lookup knows nothing, fails, or the
 * address is not a known board (a company with its own careers software). It never throws.
 */
export async function resolveToOfficialBoard(
  partial: PartialPosting,
  boardLookup: BoardLookup,
): Promise<BoardResolution> {
  let careersUrl: string | undefined;
  try {
    careersUrl = await boardLookup(partial.company);
  } catch {
    return {
      status: "platform-only",
      reason: `Looking up the careers page of ${partial.company} failed, so the job stays platform-only.`,
    };
  }
  if (careersUrl === undefined) {
    return {
      status: "platform-only",
      reason: `No careers page is known for ${partial.company}, so the job stays platform-only.`,
    };
  }
  const board = detectBoard(careersUrl);
  if (board === undefined) {
    return {
      status: "platform-only",
      reason: `The careers page of ${partial.company} is not a job board Scout can read, so the job stays platform-only.`,
    };
  }
  return { status: "resolved", board, careersUrl };
}

/** A title must overlap this much (shared words over all words) to count as the same role. */
const SAME_ROLE_OVERLAP = 0.75;

/** Overlap between two titles: shared role words divided by all role words of both. */
function titleOverlap(first: string, second: string): number {
  const firstWords = new Set(titleWords(first));
  const secondWords = new Set(titleWords(second));
  const union = new Set([...firstWords, ...secondWords]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const word of firstWords) {
    if (secondWords.has(word)) shared += 1;
  }
  return shared / union.size;
}

/**
 * Picks the posting on the company's own board that is the job the alert listed, comparing role
 * words in the titles. Returns undefined when none is close enough or when two are equally close
 * (it never guesses).
 *
 * Example: the alert says "Backend Engineer"; the board has "Backend Engineer" and
 * "Frontend Engineer"; the first is returned.
 */
export function pickMatchingPosting(
  partial: PartialPosting,
  boardPostings: Posting[],
): Posting | undefined {
  const ranked = boardPostings
    .map((posting) => ({ posting, overlap: titleOverlap(partial.title, posting.title) }))
    .filter((entry) => entry.overlap >= SAME_ROLE_OVERLAP)
    .sort((first, second) => second.overlap - first.overlap);
  const best = ranked[0];
  if (best === undefined) return undefined;
  const next = ranked[1];
  if (next !== undefined && next.overlap === best.overlap) return undefined;
  return best.posting;
}
