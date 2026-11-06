/**
 * Finds which job an email is about.
 *
 * Why it exists: a reply is only useful when it is tied to the right application. The matcher
 * scores each job by where its company name appears (sender domain, sender display name,
 * subject, body) and how many of its role words appear. It only answers when one job is clearly
 * ahead. When two jobs look equally likely it answers `unmatched` and lists the candidates, so a
 * person decides. It never guesses.
 *
 * Example: a message from "Harbor Systems Talent <talent@harbor-systems.example.com>" about a
 * "Backend Engineer" matches the Harbor Systems backend job, but not the Harbor Systems
 * "Frontend Engineer" job.
 */
import type { JobRecord, JobStatus } from "../shared/index.js";
import { senderDomain } from "./parse-message.js";
import type { ParsedMessage } from "./message-types.js";
import { companySlug, companyWords, titleWords, wordsOf } from "./words.js";

/** Statuses a reply can be about: the application went out. Earlier jobs have nothing to reply to. */
export const REPLYABLE_STATUSES: readonly JobStatus[] = [
  "applied",
  "contacted",
  "interviewing",
  "offer",
  "unverified",
  "rejected",
];

/** The best job must lead the second best by at least this many points to count as a match. */
export const MINIMUM_LEAD = 2;

/** The best job must reach at least this many points in total. */
export const MINIMUM_SCORE = 3;

/** One job that could be the one the message is about. */
export interface MatchCandidate {
  jobId: string;
  score: number;
  reasons: string[];
}

/** The answer of `matchMessageToJob`. */
export type MatchResult =
  | { kind: "matched"; jobId: string; score: number; reasons: string[] }
  | { kind: "unmatched"; candidates: MatchCandidate[] };

/** Points per place the company name is found. The company must be found somewhere. */
const POINTS = {
  domain: 3,
  senderName: 3,
  subject: 2,
  body: 1,
  roleExact: 3,
  rolePartial: 1,
} as const;

/**
 * The company evidence is capped, so that four mentions of the same company do not drown out the
 * difference between two roles at that company.
 */
const MAXIMUM_COMPANY_POINTS = 4;

/** True when every word of `needle` appears in `haystackWords`, as whole words. */
function containsAllWords(haystackWords: string[], needle: string[]): boolean {
  return needle.length > 0 && needle.every((word) => haystackWords.includes(word));
}

/** True when every word of the company name is found in `text`, as whole words. */
function mentionsCompany(text: string, company: string): boolean {
  return containsAllWords(wordsOf(text), companyWords(company));
}

/**
 * True when a label of the sender's domain is the company name: the squashed name ("harborsystems"
 * for "harbor-systems"), the name followed by more letters, or the company's first word when that
 * is at least 4 letters. A label that merely contains the name inside another word does not count.
 */
function domainNamesCompany(domain: string, company: string): boolean {
  const slug = companySlug(company);
  const firstWord = companyWords(company)[0] ?? "";
  return domain.split(".").some((label) => {
    const squashed = label.replace(/[^a-z0-9]/g, "");
    if (squashed === "") return false;
    return (
      squashed === slug ||
      (slug.length >= 4 && squashed.startsWith(slug)) ||
      (firstWord.length >= 4 && squashed === firstWord)
    );
  });
}

/** Scores one job against one message. */
function scoreJob(message: ParsedMessage, job: JobRecord): MatchCandidate {
  const reasons: string[] = [];
  let score = 0;

  if (domainNamesCompany(senderDomain(message), job.company)) {
    score += POINTS.domain;
    reasons.push("the sender's domain names the company");
  }
  if (mentionsCompany(message.fromName, job.company)) {
    score += POINTS.senderName;
    reasons.push("the sender's name mentions the company");
  }
  if (mentionsCompany(message.subject, job.company)) {
    score += POINTS.subject;
    reasons.push("the subject mentions the company");
  }
  if (mentionsCompany(message.text, job.company)) {
    score += POINTS.body;
    reasons.push("the text mentions the company");
  }
  if (score === 0) return { jobId: job.id, score: 0, reasons };
  score = Math.min(score, MAXIMUM_COMPANY_POINTS);

  const heading = `${message.subject}\n${message.text}`;
  const headingWords = wordsOf(heading);
  const roleWords = titleWords(job.title);
  if (heading.toLowerCase().includes(job.title.toLowerCase())) {
    score += POINTS.roleExact;
    reasons.push("the full job title appears");
  } else if (roleWords.length > 0) {
    const found = roleWords.filter((word) => headingWords.includes(word));
    if (found.length === roleWords.length) {
      score += POINTS.roleExact;
      reasons.push("every role word appears");
    } else if (found.length * 2 >= roleWords.length) {
      score += POINTS.rolePartial;
      reasons.push("some role words appear");
    }
  }
  return { jobId: job.id, score, reasons };
}

/**
 * Matches a message to one of `jobs`, or reports `unmatched` with the likely candidates.
 *
 * Only jobs in `REPLYABLE_STATUSES` are considered. A job matches when its score is at least
 * `MINIMUM_SCORE` and it leads the next job by `MINIMUM_LEAD`. Candidates (every job with a
 * score above 0, best first) are listed so a person can pick.
 *
 * Example: two Harbor Systems jobs (Backend Engineer, Frontend Engineer) and a message that says
 * only "Harbor Systems: we would like to schedule an interview" gives `unmatched` with both as
 * candidates, because nothing separates them.
 */
export function matchMessageToJob(message: ParsedMessage, jobs: JobRecord[]): MatchResult {
  const candidates = jobs
    .filter((job) => REPLYABLE_STATUSES.includes(job.status))
    .map((job) => scoreJob(message, job))
    .filter((candidate) => candidate.score > 0)
    .sort((first, second) => second.score - first.score);

  const best = candidates[0];
  if (best === undefined) return { kind: "unmatched", candidates: [] };
  const second = candidates[1];
  const clearLead = second === undefined || best.score - second.score >= MINIMUM_LEAD;
  if (best.score >= MINIMUM_SCORE && clearLead) {
    return { kind: "matched", jobId: best.jobId, score: best.score, reasons: best.reasons };
  }
  return { kind: "unmatched", candidates };
}
