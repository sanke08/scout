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
import {
  buildHealthReport,
  createJobFolderManager,
  type HealthReport,
  type JobFolderManager,
} from "../folders/index.js";
import {
  LEDGER_FILE_NAME,
  createHandoffStore,
  createLedger,
  createLedgerStore,
  withLedger,
  type HandoffStore,
  type Ledger,
} from "../ledger/index.js";
import type { PlatformOverrides } from "../platforms/index.js";
import { createProfileStore, createProposalStore, type ProposalStore } from "../profile/index.js";
import { createResumeBuilder } from "../resume/index.js";
import {
  dataDirectory,
  ScoutError,
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
  runInTransaction,
  createActionLog,
  createJobStore,
  createSettingsStore,
  openDatabase,
  type DatabaseSync,
} from "../store/index.js";
import {
  createImapConnector,
  type ConnectToMailbox,
  type ImapCredentials,
} from "../tracking/index.js";
import { countSubmitsToday } from "./commands/apply-preparation.js";
import type { ApplyEnvironmentOverrides } from "./commands/apply-environment.js";
import { createBoardStore, type BoardStore } from "./boards-store.js";
import { readModelCallsToday, syncJobFolder, withFolderSync } from "./folder-support.js";
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
  /** Starts the `claude` program. Default: the real runner. Used only without `brain`. */
  processRunner?: ProcessRunner;
  /** Company names the user never wants (feeds the decider's blacklist rule). Default: none. */
  blacklist?: readonly string[];
  settingsStore?: SettingsStore;
  /** Replace both `jobStore` and `actionLog` to avoid opening the database at all. */
  jobStore?: JobStore;
  actionLog?: ActionLog;
  profileStore?: ProfileStore;
  resumeBuilder?: ResumeBuilder;
  /** The job folders. Default: one folder per job under `<directory>/jobs`. Tests may pass a fake. */
  folders?: JobFolderManager;
  /**
   * The environment variables Scout reads (only the `SCOUT_IMAP_*` mail settings come from here).
   * Default: the real `process.env`. Tests pass a plain object so they never touch the real one.
   */
  environment?: Readonly<Record<string, string | undefined>>;
  /**
   * Makes the mailbox connection from the credentials. Default: the real, read-only IMAP
   * connection. Tests pass a function that returns a fake connection serving saved emails.
   */
  mailboxConnector?: (credentials: ImapCredentials) => ConnectToMailbox;
  /**
   * Replaces the outside effects of `scout apply` (browser, page download, typed line, LaTeX compile,
   * pause). Tests pass fakes here; the real program passes none.
   */
  apply?: ApplyEnvironmentOverrides;
  /**
   * Replaces the credential vault (the OS keychain) of the platform sign-in commands. Tests pass a
   * fake vault here; the real program passes none. The browser comes from `apply.openBrowser`.
   */
  platforms?: PlatformOverrides;
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
  /** The application ledger: every application, its recruiter, history and next step. */
  readonly ledger: Ledger;
  /**
   * The private record of forms handed to the owner at Fill, I submit. Only `apply_to_job` and the
   * helper process write to it; it is what lets the ledger record the owner's own submit.
   */
  readonly handoffs: HandoffStore;
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
  /** The environment variables in use (see `ApplicationOptions.environment`). */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Makes the read-only mailbox connection for these credentials (see `ApplicationOptions.mailboxConnector`). */
  mailboxConnector(credentials: ImapCredentials): ConnectToMailbox;
  /** Throws `ScoutError("paused")` while the kill switch is on. Every acting step calls it first. */
  assertNotPaused(): void;
  /**
   * Moves a job to `submitting` and checks today's limit in ONE database transaction, so two
   * calls (or two processes) can never both pass at limit minus one. Throws `limit-reached` when
   * this submit would be more than `dailyLimit` submits today; the job is then unchanged.
   */
  claimSubmitSlot(jobId: string, reason: string, dailyLimit: number): void;
  /** One folder per job (`<directory>/jobs`): the description, resumes and a log, kept in step with the store. */
  readonly folders: JobFolderManager;
  /**
   * Makes the job's folder match the store (creating it when the job is shortlisted). Transitions
   * made through `jobStore` already do this; call it only after changing a job some other way.
   */
  syncJobFolder(jobId: string): void;
  /** The health report: last successes, queue sizes, model calls today, paused flag, jobs needing you. */
  healthReport(): HealthReport;
  /** Closes the database. Call once when the command ends. */
  close(): void;
}

/**
 * Builds the real brain: the `claude` command (always Sonnet 5.5) with a budget and a cache. It serves
 * the single-shot jobs (notes, interview plans, mail classification); autopilot runs separately.
 */
function buildRealBrain(
  application: Pick<Application, "directory" | "settingsStore" | "profileStore" | "now">,
  processRunner: ProcessRunner | undefined,
): Brain {
  const settings = application.settingsStore.load();
  const profile = application.profileStore.load();
  const runnerOption = processRunner === undefined ? {} : { runner: processRunner };
  return createBrainRouter({
    primary: createCommandBrain({ engine: "claude", now: application.now, ...runnerOption }),
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
  const storedJobs = options.jobStore ?? createJobStore(database!, now);
  const actionLog = options.actionLog ?? createActionLog(database!, now);
  const folders =
    options.folders ?? createJobFolderManager({ jobsDirectory: join(directory, "jobs"), now });
  const handoffs = createHandoffStore(join(directory, "apply-helpers", "handoffs.json"), now);
  let ledgerInstance: Ledger | undefined;
  let ledgerDatabase: DatabaseSync | undefined;
  const folderSyncedJobs = withFolderSync(storedJobs, { folders, actionLog });
  const jobStore = withLedger(
    folderSyncedJobs,
    () => getLedger(),
    (message) =>
      actionLog.append({ actor: "ledger", action: "ledger-sync-failed", detail: message }),
  );
  /** Builds the ledger on first use; it shares the main database when there is one. */
  function getLedger(): Ledger {
    if (ledgerInstance === undefined) {
      const ledgerTables =
        database ?? (ledgerDatabase = openDatabase(join(directory, "scout.sqlite")));
      ledgerInstance = createLedger({
        jobStore,
        store: createLedgerStore(ledgerTables),
        handoffs,
        now,
        filePath: join(directory, LEDGER_FILE_NAME),
        onFileError: (message) =>
          actionLog.append({ actor: "ledger", action: "ledger-file-failed", detail: message }),
      });
    }
    return ledgerInstance;
  }
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
    environment: options.environment ?? process.env,
    mailboxConnector: options.mailboxConnector ?? createImapConnector,
    settingsStore,
    jobStore,
    actionLog,
    profileStore,
    proposalStore,
    resumeBuilder: options.resumeBuilder ?? createResumeBuilder(),
    discovery,
    boardStore: createBoardStore(join(directory, "boards.json")),
    scoreStore: createScoreStore(join(directory, "scores.json")),
    handoffs,
    get ledger() {
      return getLedger();
    },
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
    claimSubmitSlot(jobId, reason, dailyLimit) {
      const claim = (): void => {
        if (countSubmitsToday(actionLog, now()) + 1 > dailyLimit) {
          throw new ScoutError(
            "limit-reached",
            `Today's limit of ${dailyLimit} applications is reached, so Scout will not submit another one until tomorrow.`,
          );
        }
        jobStore.transition(jobId, "submitting", reason);
      };
      if (database === undefined) claim();
      else runInTransaction(database, claim);
    },
    folders,
    syncJobFolder(jobId) {
      syncJobFolder({ jobStore, folders, actionLog }, jobId);
    },
    healthReport() {
      return buildHealthReport({
        jobStore,
        settings: settingsStore.load(),
        actionLog,
        now,
        modelCallsToday: () => readModelCallsToday(directory, now()),
      });
    },
    close() {
      database?.close();
      ledgerDatabase?.close();
    },
  };
  return application;
}
