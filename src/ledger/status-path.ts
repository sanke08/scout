/**
 * Finds the legal steps from one status to another, for a status the user reports by hand.
 *
 * Why it exists: the state machine does not allow `applied` to jump straight to `offer`, but a user
 * who gets an offer call should not have to record two steps. Scout walks the legal steps for
 * them and writes each one down, so the history stays truthful and no rule is bypassed.
 *
 * Example: `statusPath("applied", undefined, "offer")` is `["contacted", "offer"]`; a move that no
 * chain of legal steps reaches (for example `rejected` to `applied`) gives `undefined`.
 */
import { allowedNextStatuses } from "../store/index.js";
import type { JobStatus } from "../shared/index.js";

/** Statuses Scout may pass through on the way; it never routes through a side status. */
const ROUTE_STATUSES: readonly JobStatus[] = [
  "applied",
  "contacted",
  "interviewing",
  "offer",
  "unverified",
];

/**
 * Returns the statuses to move through, ending with `target`, or `undefined` when there is no legal
 * way. An empty list means the job is already at `target`.
 */
export function statusPath(
  from: JobStatus,
  previous: JobStatus | undefined,
  target: JobStatus,
): JobStatus[] | undefined {
  if (from === target) return [];
  const queue: { status: JobStatus; path: JobStatus[] }[] = [{ status: from, path: [] }];
  const seen = new Set<JobStatus>([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const next = allowedNextStatuses(
      current.status,
      current.status === from ? previous : undefined,
    );
    for (const status of next) {
      if (seen.has(status)) continue;
      const path = [...current.path, status];
      if (status === target) return path;
      seen.add(status);
      if (ROUTE_STATUSES.includes(status)) queue.push({ status, path });
    }
  }
  return undefined;
}

/** Every status the user may report from here: the target of at least one legal chain. */
export function reachableStatuses(from: JobStatus, previous: JobStatus | undefined): JobStatus[] {
  const reachable: JobStatus[] = [];
  const candidates = new Set<JobStatus>();
  for (const status of ROUTE_STATUSES) candidates.add(status);
  for (const status of allowedNextStatuses(from, previous)) candidates.add(status);
  for (const status of ["rejected", "withdrawn", "closed"] as const) candidates.add(status);
  for (const status of candidates) {
    if (status === from) continue;
    if (statusPath(from, previous, status) !== undefined) reachable.push(status);
  }
  return reachable;
}
