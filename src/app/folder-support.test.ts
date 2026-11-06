/** Tests for the store-to-folder sync and the model-call counter. Fictional data in temporary folders. */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JobFolderManager } from "../folders/index.js";
import { ScoutError } from "../shared/index.js";
import { readModelCallsToday } from "./folder-support.js";
import {
  makeNumberedPosting,
  makeTestApplication,
  TEST_NOW,
  type TestApplication,
} from "./test-helpers.js";

let testApplication: TestApplication;

beforeEach(() => {
  testApplication = makeTestApplication([]);
});

afterEach(() => {
  testApplication.cleanUp();
});

/** The names of the job folders in the test data folder. */
function folderNames(): string[] {
  const jobs = join(testApplication.directory, "jobs");
  return existsSync(jobs) ? readdirSync(jobs) : [];
}

describe("job folder sync", () => {
  it("creates no folder for a job that is only found or skipped", () => {
    const { application } = testApplication;
    application.jobStore.upsertPosting(makeNumberedPosting(1));
    application.jobStore.upsertPosting(makeNumberedPosting(2));
    application.jobStore.transition("posting-2", "skipped", "Seniority too high.");
    expect(folderNames()).toEqual([]);
  });

  it("creates the folder at the shortlist with the description word for word, once", () => {
    const { application } = testApplication;
    const description = "Line one.\n\nLine two with <b>markup</b> & symbols: 100% remote?";
    application.jobStore.upsertPosting(makeNumberedPosting(1, { description }));
    application.jobStore.transition("posting-1", "shortlisted", "Score 80.");
    const names = folderNames();
    expect(names).toHaveLength(1);
    const text = readFileSync(join(testApplication.directory, "jobs", names[0]!, "job.md"), "utf8");
    expect(text).toContain(description);
    expect(text).toMatch(/status: shortlisted/);
    expect(text).toMatch(/Score 80\./);
  });

  it("follows later status changes one way and never creates a second folder", () => {
    const { application } = testApplication;
    application.jobStore.upsertPosting(makeNumberedPosting(1));
    application.jobStore.transition("posting-1", "shortlisted", "Score 80.");
    application.jobStore.transition("posting-1", "resume-ready", "Resume built.");
    expect(folderNames()).toHaveLength(1);
    const name = folderNames()[0]!;
    const job = application.folders.readJob(name);
    expect(job.fields["status"]).toBe("resume-ready");
    expect(job.body).toMatch(/Status is now resume-ready: Resume built\./);
    expect(application.jobStore.get("posting-1")?.status).toBe("resume-ready");
  });

  it("records a failed folder update in the action log and keeps the store change", () => {
    const real = testApplication.application.folders;
    const breaking: JobFolderManager = {
      ...real,
      setStatus() {
        throw new ScoutError("invalid-input", "The job.md has no front matter.");
      },
    };
    const other = makeTestApplication([], { folders: breaking });
    try {
      other.application.jobStore.upsertPosting(makeNumberedPosting(1));
      other.application.jobStore.transition("posting-1", "shortlisted", "Score 80.");
      other.application.jobStore.transition("posting-1", "resume-ready", "Resume built.");
      expect(other.application.jobStore.get("posting-1")?.status).toBe("resume-ready");
      const failed = other.application.actionLog
        .recent(20)
        .filter((entry) => entry.action === "folder-sync-failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.detail).toMatch(/was not updated/);
    } finally {
      other.cleanUp();
    }
  });
});

describe("model calls today", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "scout-budget-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reads today's count, and returns 0 for another day, a damaged file or no file", () => {
    expect(readModelCallsToday(directory, TEST_NOW)).toBe(0);
    writeFileSync(join(directory, "model-budget.json"), '{"day":"2026-11-07","used":12}');
    expect(readModelCallsToday(directory, TEST_NOW)).toBe(12);
    expect(readModelCallsToday(directory, new Date("2026-11-08T01:00:00Z"))).toBe(0);
    writeFileSync(join(directory, "model-budget.json"), "not json");
    expect(readModelCallsToday(directory, TEST_NOW)).toBe(0);
  });
});
