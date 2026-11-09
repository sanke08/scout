/**
 * The private record of forms Scout handed to the owner to submit ("Fill, I submit").
 *
 * Why it exists: a job may be recorded as applied from `needs-you` only when the owner really had
 * the filled form in front of them. That fact must come from something the model cannot write. The
 * model can put any words it likes into a job's reason (`flag_for_user`), so the reason text proves
 * nothing. This record lives in `<data>/apply-helpers/handoffs.json`, a file no tool writes: only
 * `apply_to_job` (which starts a hand-off and gets a random token) and the helper process (which
 * proves it holds the token once the form is filled and the window is open) change it.
 *
 * States of one hand-off: `starting` (the tool wrote it, the helper has not filled the form yet),
 * `waiting` (the helper filled the form and the window is open for the owner) and `ended` (the
 * helper finished, was refused, or something else moved the job). Only `waiting` lets a `needs-you`
 * job be recorded as applied. Any status change of the job while it is `waiting` ends the hand-off,
 * so a stale record can never be reused later (see `Ledger.noteTransition`).
 *
 * Example: `const token = store.begin("job-1")`, later `store.markWaiting("job-1", token)`;
 * `store.isWaiting("job-1")` is then true until the job's status changes.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeTextAtomic } from "../folders/index.js";
import { ScoutError } from "../shared/index.js";

/** Where a hand-off stands. */
export type HandoffState = "starting" | "waiting" | "ended";

/** What is kept for one job. */
interface HandoffEntry {
  token: string;
  state: HandoffState;
  startedAt: string;
}

/** The hand-off record as the ledger and the apply code use it. */
export interface HandoffStore {
  /** Starts a hand-off for the job (replacing an older one) and returns its secret token. */
  begin(jobId: string): string;
  /** True when `token` is the token of the job's latest hand-off. */
  matches(jobId: string, token: string | undefined): boolean;
  /**
   * The helper says the form is filled and the window is open for the owner.
   * Failure: `unsafe` when the token is not the latest hand-off's, so a forged call changes nothing.
   */
  markWaiting(jobId: string, token: string | undefined): void;
  /** True while a helper has the filled form open for the owner. */
  isWaiting(jobId: string): boolean;
  /** Ends the job's hand-off (any state). Safe when there is none. */
  end(jobId: string): void;
  /**
   * The jobs whose hand-off began less than `withinMilliseconds` ago and whose helper has not yet
   * filled the form. A helper that is just starting has no lock file yet, so this is how a second
   * hand-off notices that the browser profile is about to be taken.
   */
  startingJobs(withinMilliseconds: number): string[];
}

/** Reads the file; a missing or damaged file is an empty record. */
function readEntries(path: string): Record<string, HandoffEntry> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, HandoffEntry>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Creates the store over the file at `path`. Nothing is written until `begin`. */
export function createHandoffStore(path: string, now: () => Date): HandoffStore {
  function save(entries: Record<string, HandoffEntry>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeTextAtomic(path, `${JSON.stringify(entries, null, 2)}\n`);
  }
  return {
    begin(jobId) {
      const entries = readEntries(path);
      const token = randomBytes(16).toString("hex");
      entries[jobId] = { token, state: "starting", startedAt: now().toISOString() };
      save(entries);
      return token;
    },
    matches(jobId, token) {
      return token !== undefined && token !== "" && readEntries(path)[jobId]?.token === token;
    },
    markWaiting(jobId, token) {
      const entries = readEntries(path);
      const entry = entries[jobId];
      if (entry === undefined || token === undefined || entry.token !== token) {
        throw new ScoutError(
          "unsafe",
          `The hand-off for job ${jobId} was not started by Scout's apply tool, so the helper stops and nothing is recorded.`,
        );
      }
      entries[jobId] = { ...entry, state: "waiting" };
      save(entries);
    },
    startingJobs(withinMilliseconds) {
      const cutoff = now().getTime() - withinMilliseconds;
      return Object.entries(readEntries(path))
        .filter(
          ([, entry]) => entry.state === "starting" && new Date(entry.startedAt).getTime() > cutoff,
        )
        .map(([jobId]) => jobId);
    },
    isWaiting: (jobId) => readEntries(path)[jobId]?.state === "waiting",
    end(jobId) {
      const entries = readEntries(path);
      const entry = entries[jobId];
      if (entry === undefined || entry.state === "ended") return;
      entries[jobId] = { ...entry, state: "ended" };
      save(entries);
    },
  };
}
