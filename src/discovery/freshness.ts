/**
 * Freshness: which postings have disappeared from their board, and which are reposts.
 */
import type { Posting } from "../shared/index.js";
import { sameJobKey } from "./dedupe.js";
import {
  FLAG_CLOSED,
  FLAG_REPOST,
  REPOST_COUNT_PREFIX,
  repostCount,
  withDetectedFlags,
  withFlags,
} from "./flags.js";

/**
 * Returns the postings that were in `previous` but are not in `current`, each marked closed.
 *
 * Pass the postings of ONE board from the earlier run and from the latest successful fetch of
 * that same board. A posting counts as present when its id or its canonical address is in
 * `current`. A fetch that failed must never be passed here: an empty `current` closes everything.
 *
 * Example: previous holds jobs A and B, current holds A: the result is B with the flag "closed".
 */
export function closedSince(previous: Posting[], current: Posting[]): Posting[] {
  const presentIds = new Set(current.map((posting) => posting.id));
  const presentUrls = new Set(current.map((posting) => posting.canonicalUrl));
  return previous
    .filter((posting) => !presentIds.has(posting.id) && !presentUrls.has(posting.canonicalUrl))
    .map((posting) => withFlags(posting, [FLAG_CLOSED]));
}

/** Returns only the flags that record reposts: "repost" and "reposts:N". */
function repostFlagsOf(posting: Posting): string[] {
  return posting.flags.filter(
    (flag) => flag === FLAG_REPOST || flag.startsWith(REPOST_COUNT_PREFIX),
  );
}

/**
 * Marks postings in `current` that are the same job as one in `previous` but with a new posted
 * date, adding the flags "repost" and "reposts:N" (N counts all reposts so far). The ghost check
 * is run again afterwards, because three reposts make a job a ghost suspect.
 *
 * A job is "the same" when it has the same id, or the same company, title and location. A job
 * whose posted date did not change keeps the repost flags it already had; it is not a new
 * repost. A posting with no posted date is never marked, because nothing proves the date is new.
 *
 * Example: previous has "Platform Engineer" posted 2026-08-01 and current has it posted
 * 2026-10-01: the current one comes back with "repost" and "reposts:1".
 */
export function markReposts(previous: Posting[], current: Posting[], now: Date): Posting[] {
  const previousByKey = new Map<string, Posting>();
  const previousById = new Map<string, Posting>();
  for (const posting of previous) {
    previousByKey.set(sameJobKey(posting), posting);
    previousById.set(posting.id, posting);
  }
  return current.map((posting) => {
    const earlier = previousById.get(posting.id) ?? previousByKey.get(sameJobKey(posting));
    if (earlier === undefined || posting.postedAt === undefined) return posting;
    const isNewDate = earlier.postedAt !== undefined && earlier.postedAt !== posting.postedAt;
    const flags = isNewDate
      ? [FLAG_REPOST, `${REPOST_COUNT_PREFIX}${repostCount(earlier) + 1}`]
      : repostFlagsOf(earlier);
    const withoutOldCount = {
      ...posting,
      flags: posting.flags.filter((flag) => !flag.startsWith(REPOST_COUNT_PREFIX)),
    };
    return withDetectedFlags(withFlags(withoutOldCount, flags), now);
  });
}
