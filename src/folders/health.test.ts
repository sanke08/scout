import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/index.js";
import { createActionLog, createJobStore, openDatabase } from "../store/index.js";
import type { DatabaseSync } from "../store/index.js";
import { buildHealthReport, isHeartbeatStale, renderHealthText } from "./health.js";
import { makePosting, makeTemporaryFolder } from "./test-helpers.js";

let temporary: ReturnType<typeof makeTemporaryFolder>;
let database: DatabaseSync;
const now = new Date("2026-11-07T12:00:00.000Z");

beforeEach(() => {
  temporary = makeTemporaryFolder();
  mkdirSync(temporary.path, { recursive: true });
  database = openDatabase(join(temporary.path, "scout.sqlite"));
});
afterEach(() => {
  database.close();
  temporary.remove();
});

describe("isHeartbeatStale", () => {
  it("is stale only after more than the window, and when there is no run at all", () => {
    expect(isHeartbeatStale("2026-11-06T11:00:00Z", now, 24)).toBe(true);
    expect(isHeartbeatStale("2026-11-06T13:00:00Z", now, 24)).toBe(false);
    expect(isHeartbeatStale(new Date("2026-11-06T12:00:00Z"), now, 24)).toBe(false);
    expect(isHeartbeatStale(undefined, now)).toBe(true);
    expect(isHeartbeatStale("not a date", now)).toBe(true);
  });

  it("refuses a window that is not positive", () => {
    expect(() => isHeartbeatStale("2026-11-07T11:00:00Z", now, 0)).toThrow(/more than 0 hours/);
  });
});

describe("buildHealthReport", () => {
  it("counts queues, reports last success per actor, needs-you jobs, budget and pause flag", () => {
    const jobs = createJobStore(database, () => new Date("2026-11-07T08:00:00Z"));
    jobs.upsertPosting(makePosting({ id: "a", canonicalUrl: "https://example.com/a" }));
    jobs.upsertPosting(
      makePosting({ id: "b", canonicalUrl: "https://example.com/b", company: "Beta" }),
    );
    jobs.upsertPosting(
      makePosting({ id: "c", canonicalUrl: "https://example.com/c", company: "Gamma" }),
    );
    jobs.transition("b", "shortlisted", "score 90");
    jobs.transition("c", "needs-you", "a verification code is needed");

    const times = ["2026-11-07T09:00:00Z", "2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z"];
    let tick = 0;
    const log = createActionLog(database, () => new Date(times[tick++] ?? (times[2] as string)));
    log.append({ actor: "discovery", action: "fetch", detail: "12 postings" });
    log.append({ actor: "discovery", action: "fetch-failed", detail: "timeout" });
    log.append({ actor: "decide", action: "score", detail: "ok" });

    const report = buildHealthReport({
      jobStore: jobs,
      settings: { ...DEFAULT_SETTINGS, automationPaused: true, dailyModelCallBudget: 40 },
      actionLog: log,
      now: () => now,
      modelCallsToday: () => 7,
    });
    expect(report.queueSizes.found).toBe(1);
    expect(report.queueSizes.shortlisted).toBe(1);
    expect(report.queueSizes["needs-you"]).toBe(1);
    expect(report.queueSizes.applied).toBe(0);
    expect(Object.keys(report.queueSizes)).toHaveLength(16);
    expect(report.lastSuccessByActor["discovery"]).toBe("2026-11-07T09:00:00.000Z");
    expect(report.lastSuccessByActor["decide"]).toBe("2026-11-07T11:00:00.000Z");
    expect(report.lastRunAt).toBe("2026-11-07T11:00:00.000Z");
    expect(report.heartbeatStale).toBe(false);
    expect(report.modelCallsToday).toBe(7);
    expect(report.modelCallBudget).toBe(40);
    expect(report.automationPaused).toBe(true);
    expect(report.needsYou).toEqual([
      {
        id: "c",
        company: "Gamma",
        title: "Backend Engineer",
        reason: "a verification code is needed",
      },
    ]);
  });

  it("marks an empty log as a stale heartbeat and reports a bad boards file without throwing", () => {
    const boardsFile = join(temporary.path, "boards.json");
    writeFileSync(boardsFile, "not json");
    const report = buildHealthReport({
      jobStore: createJobStore(database),
      settings: DEFAULT_SETTINGS,
      actionLog: createActionLog(database),
      boardsFile,
      now: () => now,
      modelCallsToday: () => 0,
    });
    expect(report.heartbeatStale).toBe(true);
    expect(report.lastRunAt).toBeUndefined();
    expect(report.watchedBoards).toBeUndefined();
    expect(report.boardsProblem).toMatch(/not valid JSON/);
  });

  it("counts the watched boards and renders readable text", () => {
    const boardsFile = join(temporary.path, "boards.json");
    writeFileSync(boardsFile, JSON.stringify([{ kind: "greenhouse", token: "examplecorp" }]));
    const jobs = createJobStore(database);
    jobs.upsertPosting(makePosting());
    jobs.transition("posting-1", "needs-you", "login needed");
    const report = buildHealthReport({
      jobStore: jobs,
      settings: DEFAULT_SETTINGS,
      actionLog: createActionLog(database, () => new Date("2026-11-07T11:30:00Z")),
      boardsFile,
      now: () => now,
      modelCallsToday: () => 3,
    });
    expect(report.watchedBoards).toBe(1);
    const text = renderHealthText(report);
    expect(text).toContain("Automation: running.");
    expect(text).toContain("Model calls today: 3 of 40.");
    expect(text).toContain("Boards watched: 1.");
    expect(text).toContain("needs-you: 1");
    expect(text).toContain("ExampleCorp, Backend Engineer (posting-1): login needed");
    expect(renderHealthText({ ...report, automationPaused: true, heartbeatStale: true })).toMatch(
      /PAUSED[\s\S]*STALE/,
    );
  });
});
