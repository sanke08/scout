/**
 * Counts how jobs moved through the pipeline: discovered, shortlisted, applied, replied,
 * interviewing, offered.
 *
 * Why it exists: the user wants to see where applications stall and which sources and posting
 * ages work. This is a pure function: the same jobs and log always give the same numbers.
 *
 * A job "reached" a stage if it is there now or the action log shows it passed through. A job
 * that was rejected after interviewing counts as interviewing, replied and applied. Jobs found
 * in the log or the list only by their current status still count correctly, because earlier
 * stages are implied by later ones (a job cannot be `applied` without having been shortlisted).
 *
 * Example: `buildFunnel(jobs, log).total` is `{ discovered: 40, shortlisted: 12, applied: 8,
 * replied: 3, interviewing: 2, offered: 0 }`.
 */
import type { ActionLogEntry, BoardKind, JobRecord, JobStatus } from "../shared/index.js";

/** The six counts of the funnel. */
export interface FunnelCounts {
  discovered: number;
  shortlisted: number;
  applied: number;
  /** Any answer from the company: contact, interview, offer or rejection. */
  replied: number;
  interviewing: number;
  offered: number;
}

/** Posting age at apply time, in buckets. `unknown` means the posting had no posted date. */
export const AGE_BUCKETS = ["0-2 days", "3-7 days", "8-14 days", "15+ days", "unknown"] as const;

/** One age bucket name. */
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** How many applications fell in an age bucket, and how many of them got a reply. */
export interface AgeCounts {
  applied: number;
  replied: number;
}

/** The whole funnel. */
export interface Funnel {
  total: FunnelCounts;
  /** Counts per source (the board kind the job came from). Only boards that occur are listed. */
  byBoard: Partial<Record<BoardKind, FunnelCounts>>;
  /** Applications by how old the posting was when applied. Every bucket is present. */
  byPostingAge: Record<AgeBucket, AgeCounts>;
}

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that mean the job went through shortlisting (or was past it). */
const SHORTLISTED_OR_LATER: JobStatus[] = [
  "shortlisted",
  "resume-ready",
  "approved",
  "submitting",
  "applied",
  "unverified",
  "contacted",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

/** Statuses that mean the application went out and Scout knows it. */
const APPLIED_OR_LATER: JobStatus[] = ["applied", "contacted", "interviewing", "offer", "rejected"];

/** Statuses that mean the company answered. */
const REPLIED_STATUSES: JobStatus[] = ["contacted", "interviewing", "offer", "rejected"];

/** Matches the store's transition log line "applied -> interviewing: reason". */
const TRANSITION_DETAIL = /^([a-z-]+) -> ([a-z-]+):/;

/** The statuses each job has been in, from the action log's transition lines. */
function statusesFromLog(entries: ActionLogEntry[]): Map<string, Set<JobStatus>> {
  const byJob = new Map<string, Set<JobStatus>>();
  for (const entry of entries) {
    if (entry.action !== "transition" || entry.jobId === undefined) continue;
    const parts = TRANSITION_DETAIL.exec(entry.detail);
    if (parts === null) continue;
    const seen = byJob.get(entry.jobId) ?? new Set<JobStatus>();
    seen.add(parts[1] as JobStatus);
    seen.add(parts[2] as JobStatus);
    byJob.set(entry.jobId, seen);
  }
  return byJob;
}

/** The moment each job was applied, from the log (the first transition into `applied`). */
function applyTimesFromLog(entries: ActionLogEntry[]): Map<string, string> {
  const times = new Map<string, string>();
  for (const entry of entries) {
    if (entry.action !== "transition" || entry.jobId === undefined) continue;
    const parts = TRANSITION_DETAIL.exec(entry.detail);
    if (parts?.[2] === "applied" && !times.has(entry.jobId)) times.set(entry.jobId, entry.at);
  }
  return times;
}

/** An empty set of counts. */
function emptyCounts(): FunnelCounts {
  return { discovered: 0, shortlisted: 0, applied: 0, replied: 0, interviewing: 0, offered: 0 };
}

/** True when any status in `wanted` is in `reached`. */
function reachedAny(reached: Set<JobStatus>, wanted: JobStatus[]): boolean {
  return wanted.some((status) => reached.has(status));
}

/** Adds one job to a set of counts. */
function addJob(counts: FunnelCounts, reached: Set<JobStatus>): void {
  counts.discovered += 1;
  const applied = reachedAny(reached, APPLIED_OR_LATER);
  if (applied || reachedAny(reached, SHORTLISTED_OR_LATER)) counts.shortlisted += 1;
  if (applied) counts.applied += 1;
  if (reachedAny(reached, REPLIED_STATUSES)) counts.replied += 1;
  if (reached.has("interviewing")) counts.interviewing += 1;
  if (reached.has("offer")) counts.offered += 1;
}

/**
 * The age bucket for a job: days from the posting date to the apply time.
 * Returns `unknown` when either date is missing or unreadable.
 */
export function ageBucketOf(
  postedAt: string | undefined,
  appliedAt: string | undefined,
): AgeBucket {
  if (postedAt === undefined || appliedAt === undefined) return "unknown";
  const posted = Date.parse(postedAt);
  const applied = Date.parse(appliedAt);
  if (Number.isNaN(posted) || Number.isNaN(applied)) return "unknown";
  const days = Math.max(0, Math.floor((applied - posted) / DAY_MS));
  if (days <= 2) return "0-2 days";
  if (days <= 7) return "3-7 days";
  if (days <= 14) return "8-14 days";
  return "15+ days";
}

/**
 * Builds the funnel from the job list and the action log.
 *
 * `entries` is the action log (any order); only the store's "transition" lines are read. Counts
 * are per job, so a job that moved through five statuses is still counted once per stage.
 */
export function buildFunnel(jobs: JobRecord[], entries: ActionLogEntry[]): Funnel {
  const loggedStatuses = statusesFromLog(entries);
  const applyTimes = applyTimesFromLog(entries);

  const total = emptyCounts();
  const byBoard: Partial<Record<BoardKind, FunnelCounts>> = {};
  const byPostingAge = Object.fromEntries(
    AGE_BUCKETS.map((bucket) => [bucket, { applied: 0, replied: 0 }]),
  ) as Record<AgeBucket, AgeCounts>;

  for (const job of jobs) {
    const reached = new Set<JobStatus>(loggedStatuses.get(job.id) ?? []);
    reached.add(job.status);

    addJob(total, reached);
    const boardCounts = byBoard[job.board] ?? emptyCounts();
    addJob(boardCounts, reached);
    byBoard[job.board] = boardCounts;

    if (reachedAny(reached, APPLIED_OR_LATER)) {
      const bucket = ageBucketOf(job.postedAt, applyTimes.get(job.id));
      byPostingAge[bucket].applied += 1;
      if (reachedAny(reached, REPLIED_STATUSES)) byPostingAge[bucket].replied += 1;
    }
  }
  return { total, byBoard, byPostingAge };
}
