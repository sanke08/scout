/**
 * The glue between the job store and the job folders, and the numbers the health report needs.
 *
 * Why it exists: the store is the source of truth for a job's status; the folder's `job.md` is a
 * readable copy that must follow it, one way only (store to folder, never back). Doing the sync in
 * one place keeps every command that moves a job from having to remember it.
 *
 * Example: after `jobStore.transition("abc", "shortlisted", "score 82")`, `syncJobFolder(parts, "abc")`
 * creates `2026-11-07_Acme_Backend-Engineer/job.md` holding the description word for word.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobFolderManager } from "../folders/index.js";
import type { ActionLog, JobStore } from "../shared/index.js";
import { ScoutError } from "../shared/index.js";

/** The parts `syncJobFolder` needs. Kept small so it does not depend on the whole application. */
export interface FolderSyncParts {
  /** The store, the source of truth for status. */
  jobStore: JobStore;
  /** Where the folders live. */
  folders: JobFolderManager;
  /** Where a failed sync is recorded. */
  actionLog: ActionLog;
}

/**
 * Makes the job's folder match the store. A job gets its folder the first time it becomes
 * `shortlisted` (so the description is saved word for word at the first touch); a job that has a
 * folder gets its `status` in `job.md` and a log line whenever the store's status differs.
 * A job that never reached the shortlist (found, or skipped by a rule) gets no folder.
 *
 * Failure: a folder that cannot be written (for example a hand-damaged `job.md`) does not undo or
 * block the store change; the failure is recorded in the action log as `folder-sync-failed`.
 *
 * Example: a `found` job with no folder returns without doing anything; the same job once
 * `shortlisted` gets a folder and a first log line.
 */
export function syncJobFolder(parts: FolderSyncParts, jobId: string): void {
  const record = parts.jobStore.get(jobId);
  if (record === undefined) return;
  try {
    const existing = parts.folders.findJobFolder(record);
    if (existing === undefined) {
      if (record.status !== "shortlisted") return;
      const folder = parts.folders.ensureJobFolder(record);
      parts.folders.appendLogLine(
        folder.name,
        `Folder created because the job was shortlisted: ${record.statusReason ?? "no reason given"}`,
      );
      return;
    }
    const savedStatus = parts.folders.readJob(existing).fields["status"];
    if (savedStatus === record.status) return;
    parts.folders.setStatus(existing, record.status, record.statusReason ?? "no reason given");
  } catch (error) {
    if (!(error instanceof ScoutError)) throw error;
    parts.actionLog.append({
      actor: "folders",
      action: "folder-sync-failed",
      jobId,
      detail: `The job folder for ${record.company} - ${record.title} was not updated: ${error.message}`,
    });
  }
}

/**
 * Returns a store that behaves exactly like `inner` and also syncs the job's folder after every
 * transition. Example: `withFolderSync(store, { folders, actionLog })` replaces `store` in the app.
 */
export function withFolderSync(
  inner: JobStore,
  parts: Omit<FolderSyncParts, "jobStore">,
): JobStore {
  const synced: FolderSyncParts = { ...parts, jobStore: inner };
  return {
    upsertPosting: (posting) => inner.upsertPosting(posting),
    get: (id) => inner.get(id),
    list: (filter) => inner.list(filter),
    transition(id, to, reason) {
      const record = inner.transition(id, to, reason);
      syncJobFolder(synced, id);
      return record;
    },
  };
}

/**
 * How many model calls were spent today (UTC), read from `model-budget.json` in the data folder.
 * A missing, unreadable or out-of-date file means 0, because the status report must still work.
 * Example: a file `{"day":"2026-11-07","used":12}` on 2026-11-07 gives 12; on the next day, 0.
 */
export function readModelCallsToday(directory: string, now: Date): number {
  try {
    const saved: unknown = JSON.parse(readFileSync(join(directory, "model-budget.json"), "utf8"));
    if (typeof saved !== "object" || saved === null) return 0;
    const { day, used } = saved as { day?: unknown; used?: unknown };
    const today = now.toISOString().slice(0, 10);
    return day === today && typeof used === "number" && used >= 0 ? used : 0;
  } catch {
    return 0;
  }
}
