/**
 * Opens the Scout database and keeps its tables up to date.
 *
 * The database has a `schema_version` table holding one number. The code has an ordered list of
 * upgrade steps; opening a database runs every step the file has not seen yet, each in its own
 * transaction. A database written by a NEWER Scout is refused before anything is changed, so an
 * old copy of Scout can never damage data it does not understand.
 *
 * Example: a new empty file is upgraded 0 -> 1 and holds `schema_version = 1`.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ScoutError } from "../shared/index.js";
import { DatabaseSync } from "./sqlite-module.js";
import { runInTransaction } from "./transaction.js";

/** One upgrade: the version it produces, a plain-words summary, and the statements that do it. */
export interface SchemaUpgradeStep {
  /** The schema version the database has after this step, for example 1. Steps count up by one. */
  version: number;
  /** What the step changes, for the README and for error messages. */
  summary: string;
  /** Applies the change. Runs inside a transaction: if it throws, nothing is kept. */
  apply(database: DatabaseSync): void;
}

/**
 * Every upgrade, in order. Add new steps at the end and never edit an old one: databases already
 * in the wild have run the old text.
 */
export const SCHEMA_UPGRADE_STEPS: readonly SchemaUpgradeStep[] = [
  {
    version: 1,
    summary: "Create the jobs table and the action log table with their indexes.",
    apply(database) {
      database.exec(`
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          previous_status TEXT,
          status_reason TEXT,
          company TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          posting_json TEXT NOT NULL
        );
        CREATE INDEX jobs_status_index ON jobs (status);
        CREATE INDEX jobs_company_index ON jobs (company);
        CREATE INDEX jobs_updated_at_index ON jobs (updated_at);
        CREATE TABLE action_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          job_id TEXT,
          detail TEXT NOT NULL
        );
        CREATE INDEX action_log_job_index ON action_log (job_id);
      `);
    },
  },
  {
    version: 2,
    summary:
      "Remember which jobs were ever submitted, so a submitted job can never be skipped or re-opened.",
    apply(database) {
      database.exec(`
        ALTER TABLE jobs ADD COLUMN ever_submitted INTEGER NOT NULL DEFAULT 0;
        UPDATE jobs SET ever_submitted = 1
          WHERE status IN ('submitting', 'applied', 'contacted', 'interviewing', 'offer',
                           'rejected', 'withdrawn', 'unverified')
             OR previous_status = 'submitting'
             OR id IN (SELECT job_id FROM action_log WHERE detail LIKE '% -> submitting:%');
      `);
    },
  },
  {
    version: 3,
    summary:
      "Create the application ledger tables: recruiter and follow-up details per job, and the contact history (calls, emails, notes, status changes).",
    apply(database) {
      database.exec(`
        CREATE TABLE application_details (
          job_id TEXT PRIMARY KEY,
          external_job_id TEXT,
          recruiter_name TEXT,
          recruiter_firm TEXT,
          recruiter_email TEXT,
          recruiter_phone TEXT,
          recruiter_linkedin TEXT,
          applied_via TEXT,
          next_step TEXT,
          next_step_date TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE application_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          at TEXT NOT NULL,
          kind TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          contact TEXT
        );
        CREATE INDEX application_events_job_index ON application_events (job_id, at);
      `);
    },
  },
];

/** The newest schema version this code understands. */
export const CURRENT_SCHEMA_VERSION = SCHEMA_UPGRADE_STEPS.length;

/**
 * Reads the schema version of a database; 0 means the file has no `schema_version` table yet
 * (a brand-new file). Example: a fresh file gives 0; a database upgraded once gives 1.
 */
export function readSchemaVersion(database: DatabaseSync): number {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (table === undefined) {
    return 0;
  }
  const row = database.prepare("SELECT version FROM schema_version").get();
  if (row === undefined || typeof row["version"] !== "number") {
    throw new ScoutError(
      "unavailable",
      "The Scout database has a damaged schema_version table. Restore it from a backup or move the file away to start fresh.",
    );
  }
  return row["version"];
}

/** Records `version` as the schema version, creating the table on first use. */
function writeSchemaVersion(database: DatabaseSync, version: number): void {
  database.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  database.exec("DELETE FROM schema_version");
  database.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
}

/**
 * Brings `database` up to the last of `steps`, running only the steps it has not seen.
 * Throws `ScoutError("unavailable")` when the database is newer than the steps, without changing
 * anything. Example: a version-1 database with steps for versions 1 and 2 runs only step 2.
 */
export function upgradeDatabase(database: DatabaseSync, steps: readonly SchemaUpgradeStep[]): void {
  const newestKnown = steps.length;
  const found = readSchemaVersion(database);
  if (found > newestKnown) {
    throw new ScoutError(
      "unavailable",
      `The Scout database is at version ${found}, but this copy of Scout only understands up to version ${newestKnown}. Update Scout; the database was left untouched.`,
    );
  }
  for (const step of steps) {
    if (step.version <= found) {
      continue;
    }
    runInTransaction(database, () => {
      step.apply(database);
      writeSchemaVersion(database, step.version);
    });
  }
}

/**
 * Opens (creating if needed) the Scout database at `path`: makes the parent folder, refuses a
 * newer database before changing anything, then upgrades the schema.
 * Example: `openDatabase("/data/scout.sqlite")` returns a ready database; call `.close()` when done.
 * Failure: a newer database or a damaged file gives a `ScoutError("unavailable")`.
 */
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    const found = readSchemaVersion(database);
    if (found > CURRENT_SCHEMA_VERSION) {
      throw new ScoutError(
        "unavailable",
        `The Scout database at ${path} is at version ${found}, but this copy of Scout only understands up to version ${CURRENT_SCHEMA_VERSION}. Update Scout; the database was left untouched.`,
      );
    }
    database.exec("PRAGMA busy_timeout = 5000");
    upgradeDatabase(database, SCHEMA_UPGRADE_STEPS);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
