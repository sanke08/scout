/**
 * Interfaces ("ports") between modules. Each module implements the ports it owns and consumes
 * the others through these types, so seven people can build in parallel without waiting.
 *
 * Owners:
 * - `ProfileStore`: `src/profile`
 * - `SettingsStore`, `JobStore`, `ActionLog`: `src/store`
 * - `Brain`: `src/brain`
 * - `ResumeBuilder`: `src/resume`
 * - `Discovery`: `src/discovery`
 * - `Decider`: `src/decide`
 *
 * Only the orchestrator edits this file; if a port must change, ask for a decision record.
 */
import type { z } from "zod";
import type { JobStatus } from "./job-status.js";
import type { JobRecord, Posting } from "./job-types.js";
import type { Profile } from "./profile-types.js";
import type { Settings } from "./settings-types.js";

/** Reads and writes the profile file. Every save bumps `profile.version` by one. */
export interface ProfileStore {
  /** Loads and validates the profile. Throws `ScoutError("not-found")` if no profile exists. */
  load(): Profile;
  /** Validates and saves the profile; returns the saved profile with the new version. */
  save(profile: Profile): Profile;
  /** True when a profile file exists. */
  exists(): boolean;
}

/** Reads and writes settings. Defaults apply for any missing field. */
export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): Settings;
}

/** Filter for `JobStore.list`. */
export interface JobFilter {
  status?: JobStatus | JobStatus[];
  limit?: number;
}

/** Persistence of jobs and their state machine. */
export interface JobStore {
  /** Inserts a posting as `found`, or merges sources and `lastSeenAt` into an existing record. */
  upsertPosting(posting: Posting): JobRecord;
  get(id: string): JobRecord | undefined;
  list(filter?: JobFilter): JobRecord[];
  /**
   * Moves a job to a new status. Throws `ScoutError("illegal-transition")` when the move is not
   * allowed. Every transition is written to the action log with its reason.
   */
  transition(id: string, to: JobStatus, reason: string): JobRecord;
}

/** One line of the action log: what Scout did and why. */
export interface ActionLogEntry {
  at: string;
  /** Which part of the system acted, e.g. "store", "discovery". */
  actor: string;
  /** What happened, e.g. "transition". */
  action: string;
  jobId?: string;
  detail: string;
}

/** Append-only record of everything Scout did. */
export interface ActionLog {
  append(entry: Omit<ActionLogEntry, "at">): ActionLogEntry;
  recent(limit: number): ActionLogEntry[];
}

/** A request to the model. The reply must match `schema` or the request fails. */
export interface BrainRequest<T> {
  /** Short name of the task, used for caching and logs, e.g. "score-batch". */
  task: string;
  /** Instructions written by Scout. */
  instructions: string;
  /** Text from outside (a posting, an email). Passed as data, never as instructions. */
  untrustedText?: string;
  schema: z.ZodType<T>;
}

/** Result of a model call. Failures are values, not exceptions, so callers can degrade. */
export type BrainResult<T> =
  | { ok: true; value: T; engine: string; cached: boolean }
  | {
      ok: false;
      reason: "limit-reached" | "invalid-output" | "unavailable";
      message: string;
      /** ISO timestamp when a usage limit resets, when known. */
      resetAt?: string;
    };

/** The model bridge: Claude Code or Codex behind one interface. */
export interface Brain {
  readonly name: string;
  run<T>(request: BrainRequest<T>): Promise<BrainResult<T>>;
}

/** Everything the resume builder reports for one job. */
export interface ResumeBuild {
  /** Complete LaTeX source, ready to compile. */
  texSource: string;
  /** Estimated length in lines, and the limit it is judged against. */
  estimatedLines: number;
  lineLimit: number;
  projectsShown: string[];
  projectsLeftOut: string[];
  /** Job keywords the profile supports, and the ones it does not (never added to the resume). */
  matchedKeywords: string[];
  notInProfile: string[];
  /** File name stem such as `Alex_Rivera_ExampleCorp` (no extension). */
  fileStem: string;
}

/** Builds a one-page resume from the profile and a job's keywords, without any model call. */
export interface ResumeBuilder {
  build(profile: Profile, keywords: string[], options?: { company?: string }): ResumeBuild;
}

/** Fetches and normalises postings from official job boards and feeds. */
export interface Discovery {
  /** Reads one company's board; `now` is injected so tests are deterministic. */
  fetchBoard(board: { kind: Posting["board"]; token: string }, now: Date): Promise<Posting[]>;
}

/** The outcome of the hard-rule filters for one posting. */
export interface HardRuleVerdict {
  keep: boolean;
  /** Plain-words reasons, recorded for every dropped posting. */
  reasons: string[];
}

/** Pure decision logic that needs no model: hard rules and keyword ranking. */
export interface Decider {
  applyHardRules(posting: Posting, profile: Profile, settings: Settings): HardRuleVerdict;
  /** Higher is a better word overlap with the profile's terms (0 to 100). */
  keywordScore(posting: Posting, profile: Profile): number;
}
