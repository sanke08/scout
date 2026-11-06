/**
 * Test builders for the tracking module: saved fictional emails, a fake mailbox connection, a
 * real job store in a temporary folder, and job records. Everything is invented; addresses use
 * example.com.
 *
 * Example: `await loadFixtureMessage("rejection")` parses `fixtures/mail/rejection.eml`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  profileSchema,
  type ActionLog,
  type JobRecord,
  type JobStore,
  type Posting,
  type Profile,
  type Settings,
} from "../../src/shared/index.js";
import { createActionLog, createJobStore, openDatabase } from "../../src/store/index.js";
import type { MailConnection } from "../../src/tracking/mailbox-reader.js";
import type { ParsedMessage } from "../../src/tracking/message-types.js";
import { parseRawMessage } from "../../src/tracking/parse-message.js";

/** Returns the raw bytes of a saved email, for example `readFixtureSource("offer")`. */
export function readFixtureSource(name: string): Buffer {
  return readFileSync(new URL(`./${name}.eml`, import.meta.url));
}

/** Parses a saved email into a `ParsedMessage`. */
export async function loadFixtureMessage(name: string): Promise<ParsedMessage> {
  return parseRawMessage(readFixtureSource(name), name);
}

/** What a fake connection did, so a test can check that Scout only ever reads. */
export interface FakeConnectionLog {
  operations: string[];
}

/**
 * A fake mailbox that serves saved emails. Message ids are the fixture names. `extra` adds raw
 * messages (for example an oversize one) by id.
 */
export function makeFakeConnection(
  names: string[],
  extra: Record<string, Buffer> = {},
): { connection: MailConnection; log: FakeConnectionLog } {
  const log: FakeConnectionLog = { operations: [] };
  const ids = [...names, ...Object.keys(extra)];
  const connection: MailConnection = {
    async listMessageIds(folder, since) {
      log.operations.push(`list ${folder} ${since.toISOString()}`);
      return ids;
    },
    async fetchSource(_folder, messageId, maxBytes) {
      log.operations.push(`fetch ${messageId}`);
      const raw = extra[messageId] ?? readFixtureSource(messageId);
      return raw.subarray(0, maxBytes + 1);
    },
    async close() {
      log.operations.push("close");
    },
  };
  return { connection, log };
}

/** The sample profile (fictional person). */
export function makeProfile(): Profile {
  const raw = readFileSync(new URL("../profile.sample.json", import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(raw));
}

/** Default settings with some fields replaced. */
export function makeSettings(changes: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...changes };
}

/** A fictional posting. Pass overrides to change fields. */
export function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "job-1",
    company: "Northwind Labs",
    title: "Backend Engineer",
    location: "Berlin, Germany",
    remote: "hybrid",
    seniority: "mid",
    skills: ["Node.js"],
    description: "Build services for a fictional team.",
    firstSeenAt: "2026-10-20T00:00:00.000Z",
    lastSeenAt: "2026-10-30T00:00:00.000Z",
    sources: [{ name: "greenhouse:northwindlabs", url: "https://example.com/northwind/1" }],
    canonicalUrl: "https://example.com/northwind/1",
    board: "greenhouse",
    flags: [],
    ...overrides,
  };
}

/** A job record that is already `applied`. Pass overrides to change fields. */
export function makeJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    ...makePosting(),
    status: "applied",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The statuses a job passes through before `applied`. */
const PATH_TO_APPLIED = [
  "shortlisted",
  "resume-ready",
  "approved",
  "submitting",
  "applied",
] as const;

/** A real job store in a temporary folder, with its action log. Call `remove` when done. */
export interface TestStore {
  jobStore: JobStore;
  actionLog: ActionLog;
  /** Adds a posting and walks it to `applied`. */
  addAppliedJob(overrides?: Partial<Posting>): JobRecord;
  remove(): void;
}

/** Opens a real store (SQLite in a temporary folder) with a fixed clock. */
export function openTestStore(
  now: () => Date = () => new Date("2026-11-01T00:00:00.000Z"),
): TestStore {
  const folder = mkdtempSync(join(tmpdir(), "scout-tracking-"));
  const database = openDatabase(join(folder, "scout.sqlite"));
  const jobStore = createJobStore(database, now);
  const actionLog = createActionLog(database, now);
  return {
    jobStore,
    actionLog,
    addAppliedJob(overrides = {}) {
      const record = jobStore.upsertPosting(makePosting(overrides));
      for (const status of PATH_TO_APPLIED) {
        jobStore.transition(record.id, status, `test: ${status}`);
      }
      return jobStore.get(record.id) ?? record;
    },
    remove() {
      database.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
