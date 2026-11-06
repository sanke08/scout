/**
 * The composition root: the one place that opens the data folder and joins the modules.
 *
 * Why it exists: every module takes its dependencies as arguments (so tests can pass fakes), which
 * leaves one job for someone else: building the real ones and passing them in. The command-line
 * commands and the web server both call `createApplication` and then only parse, print and call.
 *
 * Example: `const application = createApplication(); application.jobStore.list(); application.close();`.
 * In a test: `createApplication({ directory, now: () => fixedDate, fetchImpl, brain })`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createBrainRouter,
  createCommandBrain,
  createFileCache,
  createFileDailyBudget,
  type ProcessRunner,
} from "../brain/index.js";
import { createDecider, type ScoutDecider } from "../decide/index.js";
import { createDiscovery, type FetchImplementation } from "../discovery/index.js";
import { createProfileStore, createProposalStore, type ProposalStore } from "../profile/index.js";
import { createResumeBuilder } from "../resume/index.js";
import {
  dataDirectory,
  type ActionLog,
  type Brain,
  type Discovery,
  type JobStore,
  type ProfileStore,
  type ResumeBuilder,
  type SettingsStore,
} from "../shared/index.js";
import {
  assertNotPaused,
  createActionLog,
  createJobStore,
  createSettingsStore,
  openDatabase,
  type DatabaseSync,
} from "../store/index.js";
import { createBoardStore, type BoardStore } from "./boards-store.js";
import { createScoreStore, type ScoreStore } from "./score-store.js";

/** Days after an application during which the same company is in cooldown (no setting exists yet). */
export const COOLDOWN_DAYS = 14;

/** Statuses that mean "an application was sent", used to build the cooldown list. */
const APPLIED_STATUSES = ["applied", "contacted", "interviewing", "offer", "rejected"] as const;

/**
 * Everything a test may replace. Leave a field out to get the real one.
 * Example: `{ directory: temporaryFolder, fetchImpl: fakeFetch, brain: fakeBrain, now: () => date }`.
 */
export interface ApplicationOptions {
  /** The data folder. Default: `dataDirectory()` (`SCOUT_DATA_DIR`, else `./data`). */
  directory?: string;
  /** The clock. Default: the real time. */
  now?: () => Date;
  /** The download function used by discovery. Default: the global `fetch`. */
  fetchImpl?: FetchImplementation;
  /** Minimum gap between two requests to one host, in milliseconds. Default: discovery's own (1 second). */
  hostDelayMilliseconds?: number;
  /** Replaces discovery entirely (takes precedence over `fetchImpl`). */
  discovery?: Discovery;
  /**
   * Replaces the whole brain, so the router, budget and cache are not built. Tests pass a
   * `FakeBrain` here.
   */
  brain?: Brain;
  /** Starts the `claude` and `codex` programs. Default: the real runner. Used only without `brain`. */
  processRunner?: ProcessRunner;
  /** Company names the user never wants (feeds the decider's blacklist rule). Default: none. */
  blacklist?: readonly string[];
  settingsStore?: SettingsStore;
  /** Replace both `jobStore` and `actionLog` to avoid opening the database at all. */
  jobStore?: JobStore;
  actionLog?: ActionLog;
  profileStore?: ProfileStore;
  resumeBuilder?: ResumeBuilder;
}

/** The joined-up Scout: every module, built once, plus the few helpers that need several of them. */
export interface Application {
  /** The data folder everything lives in. */
  readonly directory: string;
  /** The clock in use. */
  now(): Date;
  settingsStore: SettingsStore;
  jobStore: JobStore;
  actionLog: ActionLog;
  profileStore: ProfileStore;
  /** Model-written wordings waiting for approval (`proposals.json`). */
  proposalStore: ProposalStore;
  resumeBuilder: ResumeBuilder;
  discovery: Discovery;
  /** The watched boards (`boards.json`). */
  boardStore: BoardStore;
  /** What the model said about each posting (`scores.json`). */
  scoreStore: ScoreStore;
  /**
   * The hard-rule decider, built fresh from the stored applications so the cooldown list is
   * current. Example: after a job becomes `applied`, the next call knows its company is cooling down.
   */
  decider(): ScoutDecider;
  /**
   * The brain, built on first use because the router needs the profile version and `init` must
   * work before any profile exists. Throws `not-found` when no profile exists yet. The same
   * brain is returned on later calls.
   */
  brain(): Brain;
  /** Throws `ScoutError("paused")` while the kill switch is on. Every acting step calls it first. */
  assertNotPaused(): void;
  /** Closes the database. Call once when the command ends. */
  close(): void;
}

/** Builds the real brain: Claude and Codex as commands, the other as fallback, with budget and cache. */
function buildRealBrain(
  application: Pick<Application, "directory" | "settingsStore" | "profileStore" | "now">,
  processRunner: ProcessRunner | undefined,
): Brain {
  const settings = application.settingsStore.load();
  const profile = application.profileStore.load();
  const runnerOption = processRunner === undefined ? {} : { runner: processRunner };
  const main = settings.mainEngine;
  const other = main === "claude" ? "codex" : "claude";
  const primary = createCommandBrain({ engine: main, now: application.now, ...runnerOption });
  const fallback = settings.switchEngineOnLimit
    ? createCommandBrain({ engine: other, now: application.now, ...runnerOption })
    : undefined;
  return createBrainRouter({
    primary,
    ...(fallback === undefined ? {} : { fallback }),
    budget: createFileDailyBudget(application.directory, {
      limitPerDay: settings.dailyModelCallBudget,
      now: application.now,
    }),
    cache: createFileCache(join(application.directory, "brain-cache")),
    profileVersion: profile.version,
    now: application.now,
  });
}

/**
 * Opens the data folder (creating it) and builds every module.
 *
 * Failure: a database from a newer Scout, or a data folder that cannot be created, throws a
 * `ScoutError` with the fix. Nothing else is read here, so a missing profile is not an error yet.
 */
export function createApplication(options: ApplicationOptions = {}): Application {
  const directory = options.directory ?? dataDirectory();
  const now = options.now ?? ((): Date => new Date());
  mkdirSync(directory, { recursive: true });

  const needsDatabase = options.jobStore === undefined || options.actionLog === undefined;
  const database: DatabaseSync | undefined = needsDatabase
    ? openDatabase(join(directory, "scout.sqlite"))
    : undefined;

  const settingsStore =
    options.settingsStore ?? createSettingsStore(join(directory, "settings.json"));
  const profileStore = options.profileStore ?? createProfileStore(join(directory, "profile.json"));
  const jobStore = options.jobStore ?? createJobStore(database!, now);
  const actionLog = options.actionLog ?? createActionLog(database!, now);
  const proposalStore = createProposalStore(join(directory, "proposals.json"), { now });
  const discovery =
    options.discovery ??
    createDiscovery({
      now,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.hostDelayMilliseconds === undefined
        ? {}
        : { hostDelayMilliseconds: options.hostDelayMilliseconds }),
    });

  let brain: Brain | undefined = options.brain;

  const application: Application = {
    directory,
    now,
    settingsStore,
    jobStore,
    actionLog,
    profileStore,
    proposalStore,
    resumeBuilder: options.resumeBuilder ?? createResumeBuilder(),
    discovery,
    boardStore: createBoardStore(join(directory, "boards.json")),
    scoreStore: createScoreStore(join(directory, "scores.json")),
    decider() {
      const applications = jobStore
        .list({ status: [...APPLIED_STATUSES] })
        .map((job) => ({ company: job.company, appliedAt: job.updatedAt }));
      return createDecider({
        blacklist: options.blacklist ?? [],
        cooldown: { applications, days: COOLDOWN_DAYS, now: now() },
      });
    },
    brain() {
      brain ??= buildRealBrain(application, options.processRunner);
      return brain;
    },
    assertNotPaused() {
      assertNotPaused(settingsStore.load());
    },
    close() {
      database?.close();
    },
  };
  return application;
}
