/**
 * Public surface of the discovery module. Other modules import only from here.
 *
 * - `createDiscovery` implements the `Discovery` port.
 * - `detectBoard` finds the board kind and token from a careers address.
 * - `dedupePostings` merges the same job found on several sources.
 * - `closedSince`, `markReposts` and `describeFlag` handle freshness and warning flags.
 */
export { createDiscovery, type DiscoveryOptions } from "./discovery.js";
export { detectBoard, type DetectedBoard } from "./detect-board.js";
export { dedupePostings } from "./dedupe.js";
export { closedSince, markReposts } from "./freshness.js";
export {
  FLAG_CLOSED,
  FLAG_GHOST_SUSPECT,
  FLAG_REPOST,
  FLAG_SCAM_SUSPECT,
  FLAG_SUSPICIOUS_TEXT,
  describeFlag,
  ghostReasons,
  scamReasons,
  suspiciousTextReasons,
} from "./flags.js";
export { canonicalizeUrl, postingIdFromUrl } from "./canonical-url.js";
export type { FetchImplementation } from "./http-fetcher.js";
