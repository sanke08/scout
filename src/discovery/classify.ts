/**
 * Works out two simple facts about a posting: where the work happens (remote, hybrid, onsite)
 * and how senior the role is. Both are guesses from words, so "unknown" is a normal answer.
 */
import type { RemoteKind, SeniorityKind } from "../shared/index.js";

/** Words in a location or title that say the job is hybrid. */
const HYBRID_PATTERN = /\bhybrid\b/i;

/** Words in a location or title that say the job is remote. */
const REMOTE_PATTERN = /\b(remote|work from home|work from anywhere|anywhere)\b/i;

/** Words that say the job is done at an office. */
const ONSITE_PATTERN = /\b(on-?site|in-?office|in the office|office-based)\b/i;

/** Phrases in the description that clearly describe this job as remote, not just mention remote. */
const STRONG_REMOTE_PATTERN =
  /\b(fully remote|100% remote|remote-first|remote first|this is a remote|remote (position|role|job|opportunity)|work remotely|work from anywhere)\b/i;

/**
 * Decides remote, hybrid, onsite or unknown.
 *
 * The employer's own hint (such as "remote" or "on-site" from the board) wins, then the location
 * and title, then clear phrases in the description. A passing word such as "remote teams" in the
 * description is not enough.
 *
 * Example: location "Remote - Europe" gives "remote"; location "Berlin" with description
 * "Hybrid, three days in the office" gives "hybrid"; location "Berlin" alone gives "unknown".
 */
export function detectRemote(
  location: string,
  title: string,
  description: string,
  employerHint?: string,
): RemoteKind {
  const hintedKind = remoteFromWords(employerHint ?? "");
  if (hintedKind !== "unknown") return hintedKind;
  const headline = remoteFromWords(`${location} ${title}`);
  if (headline !== "unknown") return headline;
  if (HYBRID_PATTERN.test(description)) return "hybrid";
  if (STRONG_REMOTE_PATTERN.test(description)) return "remote";
  if (ONSITE_PATTERN.test(description)) return "onsite";
  return "unknown";
}

/** Reads remote, hybrid or onsite from a short piece of text; hybrid beats remote. */
function remoteFromWords(text: string): RemoteKind {
  if (HYBRID_PATTERN.test(text)) return "hybrid";
  if (REMOTE_PATTERN.test(text)) return "remote";
  if (ONSITE_PATTERN.test(text)) return "onsite";
  return "unknown";
}

/**
 * Decides the seniority from the job title only (the description often lists other levels).
 *
 * Example: "Senior Backend Engineer" gives "senior"; "Software Engineering Intern" gives
 * "intern"; "Software Engineer II" gives "mid"; "Software Engineer" gives "unknown".
 */
export function detectSeniority(title: string): SeniorityKind {
  if (/\b(intern|internship|trainee|working student|werkstudent)\b/i.test(title)) return "intern";
  if (
    /\b(lead|principal|head of|director|vp|vice president|distinguished)\b/i.test(title) ||
    /\bstaff\s+(\w+\s+)?(engineer|developer|scientist|designer|architect)\b/i.test(title)
  ) {
    return "lead";
  }
  if (/\b(senior|sr|iii)\b/i.test(title)) return "senior";
  if (/\b(junior|jr|entry[- ]level|graduate|new grad)\b/i.test(title)) return "junior";
  if (/\b(mid[- ]level|intermediate|ii)\b/i.test(title)) return "mid";
  return "unknown";
}
