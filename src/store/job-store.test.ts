import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOB_STATUSES, ScoutError } from "../shared/index.js";
import type { JobStatus } from "../shared/index.js";
import { createActionLog } from "./action-log.js";
import { createJobStore } from "./job-store.js";
import { openDatabase } from "./schema.js";
import type { DatabaseSync } from "./sqlite-module.js";
import { ALLOWED_TRANSITIONS } from "./transitions.js";
import { makePosting, makeTemporaryFolder, makeTickingClock } from "./test-helpers.js";

let folder: ReturnType<typeof makeTemporaryFolder>;
let database: DatabaseSync;
beforeEach(() => {
  folder = makeTemporaryFolder();
  database = openDatabase(join(folder.path, "scout.sqlite"));
});
afterEach(() => {
  database.close();
  folder.remove();
});

/** Walks a fresh job along `path` (statuses after `found`) and returns the store. */
function storeWithJobAt(path: JobStatus[]) {
  const store = createJobStore(database, makeTickingClock());
  store.upsertPosting(makePosting());
  for (const status of path) {
    store.transition("posting-1", status, `step to ${status}`);
  }
  return store;
}

describe("upsertPosting", () => {
  it("inserts a new posting as found", () => {
    const record = createJobStore(database).upsertPosting(makePosting());
    expect(record.status).toBe("found");
    expect(record.id).toBe("posting-1");
  });

  it("merges sources without duplicate urls and unions the flags", () => {
    const store = createJobStore(database, makeTickingClock());
    store.upsertPosting(makePosting({ flags: ["repost"] }));
    const merged = store.upsertPosting(
      makePosting({
        flags: ["ghost-suspect", "repost"],
        lastSeenAt: "2026-02-01T00:00:00.000Z",
        sources: [
          { name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" },
          { name: "feed:example", url: "https://example.com/feed/1" },
        ],
      }),
    );
    const urls = merged.sources.map((source) => source.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("https://example.com/feed/1");
    expect([...merged.flags].sort()).toEqual(["ghost-suspect", "repost"]);
    expect(merged.lastSeenAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("never changes the status of an existing job", () => {
    const store = storeWithJobAt(["shortlisted", "resume-ready"]);
    const again = store.upsertPosting(makePosting({ lastSeenAt: "2026-03-01T00:00:00.000Z" }));
    expect(again.status).toBe("resume-ready");
  });

  it("never moves lastSeenAt backwards", () => {
    const store = createJobStore(database);
    store.upsertPosting(makePosting({ lastSeenAt: "2026-05-01T00:00:00.000Z" }));
    const again = store.upsertPosting(makePosting({ lastSeenAt: "2026-04-01T00:00:00.000Z" }));
    expect(again.lastSeenAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("keeps one row per posting id", () => {
    const store = createJobStore(database);
    store.upsertPosting(makePosting());
    store.upsertPosting(makePosting());
    expect(store.list()).toHaveLength(1);
  });

  it("rejects an invalid posting with invalid-input and saves nothing", () => {
    const store = createJobStore(database);
    const broken = { ...makePosting(), company: 42 } as unknown as ReturnType<typeof makePosting>;
    expect(() => store.upsertPosting(broken)).toThrow(ScoutError);
    expect(store.list()).toEqual([]);
    expect(createActionLog(database).recent(10)).toEqual([]);
  });

  it("logs every upsert, first sighting and repeat", () => {
    const store = createJobStore(database, makeTickingClock());
    store.upsertPosting(makePosting());
    store.upsertPosting(makePosting());
    const entries = createActionLog(database).recent(10);
    expect(entries.filter((entry) => entry.action === "upsert")).toHaveLength(2);
    expect(entries.every((entry) => entry.jobId === "posting-1")).toBe(true);
  });
});

describe("get and list", () => {
  it("returns undefined for an unknown id", () => {
    expect(createJobStore(database).get("nope")).toBeUndefined();
  });

  it("filters by one status or several, and limits, newest update first", () => {
    const store = createJobStore(database, makeTickingClock());
    for (const id of ["a", "b", "c"]) {
      store.upsertPosting(makePosting({ id, canonicalUrl: `https://example.com/${id}` }));
    }
    store.transition("b", "shortlisted", "good fit");
    store.transition("c", "skipped", "not interested");

    expect(store.list({ status: "found" }).map((job) => job.id)).toEqual(["a"]);
    expect(
      store
        .list({ status: ["shortlisted", "skipped"] })
        .map((job) => job.id)
        .sort(),
    ).toEqual(["b", "c"]);
    expect(store.list().map((job) => job.id)).toEqual(["c", "b", "a"]);
    expect(store.list({ limit: 2 })).toHaveLength(2);
    expect(store.list({ status: [] })).toEqual([]);
  });

  it("rejects a limit that is not a positive whole number", () => {
    expect(() => createJobStore(database).list({ limit: 0 })).toThrow(ScoutError);
  });

  it("keeps data when the database is closed and reopened", () => {
    const path = join(folder.path, "reopen.sqlite");
    const first = openDatabase(path);
    createJobStore(first, makeTickingClock()).upsertPosting(makePosting());
    createJobStore(first).transition("posting-1", "shortlisted", "good fit");
    first.close();

    const second = openDatabase(path);
    const record = createJobStore(second).get("posting-1");
    expect(record?.status).toBe("shortlisted");
    expect(record?.statusReason).toBe("good fit");
    expect(createActionLog(second).recent(10).length).toBeGreaterThanOrEqual(2);
    second.close();
  });
});

describe("transition", () => {
  it("throws not-found for an unknown job id", () => {
    try {
      createJobStore(database).transition("missing", "shortlisted", "why not");
      expect.unreachable("an unknown id must fail");
    } catch (error) {
      expect((error as ScoutError).code).toBe("not-found");
    }
  });

  it("throws illegal-transition for every move outside the table and changes nothing", () => {
    const store = createJobStore(database, makeTickingClock());
    store.upsertPosting(makePosting());
    for (const target of JOB_STATUSES) {
      if (ALLOWED_TRANSITIONS.found.includes(target)) {
        continue;
      }
      try {
        store.transition("posting-1", target, "should not work");
        expect.unreachable(`found -> ${target} must be refused`);
      } catch (error) {
        expect((error as ScoutError).code).toBe("illegal-transition");
        expect((error as ScoutError).message).toContain("found");
        expect((error as ScoutError).message).toContain(target);
      }
    }
    expect(store.get("posting-1")?.status).toBe("found");
  });

  it("refuses an empty reason", () => {
    const store = storeWithJobAt([]);
    expect(() => store.transition("posting-1", "shortlisted", "  ")).toThrow(ScoutError);
  });

  it("stores the reason and moves updatedAt forward", () => {
    const store = createJobStore(database, makeTickingClock());
    const first = store.upsertPosting(makePosting());
    const moved = store.transition("posting-1", "shortlisted", "score 82");
    expect(moved.statusReason).toBe("score 82");
    expect(moved.updatedAt > first.updatedAt).toBe(true);
  });

  it("writes every transition to the action log with its reason", () => {
    const path = ["shortlisted", "resume-ready", "approved", "submitting", "applied"] as const;
    const store = storeWithJobAt([...path]);
    const lines = createActionLog(database)
      .recent(50)
      .filter((entry) => entry.action === "transition");
    expect(lines).toHaveLength(path.length);
    for (const status of path) {
      expect(lines.some((line) => line.detail.includes(`-> ${status}: step to ${status}`))).toBe(
        true,
      );
    }
    expect(store.get("posting-1")?.status).toBe("applied");
  });

  it("does not log a refused transition", () => {
    const store = storeWithJobAt([]);
    const before = createActionLog(database).recent(50).length;
    expect(() => store.transition("posting-1", "applied", "skipping ahead")).toThrow(ScoutError);
    expect(createActionLog(database).recent(50)).toHaveLength(before);
  });

  it("rolls back the status change when the log line cannot be written", () => {
    const store = storeWithJobAt([]);
    database.exec("DROP TABLE action_log");
    expect(() => store.transition("posting-1", "shortlisted", "should roll back")).toThrow();
    expect(store.get("posting-1")?.status).toBe("found");
  });

  it("never lets an interrupted submit go back to approved", () => {
    const store = storeWithJobAt(["shortlisted", "resume-ready", "approved", "submitting"]);
    try {
      store.transition("posting-1", "approved", "retry the submit");
      expect.unreachable("submitting -> approved must be refused");
    } catch (error) {
      expect((error as ScoutError).code).toBe("illegal-transition");
    }
    expect(store.get("posting-1")?.status).toBe("submitting");
  });

  it("only reaches applied from submitting", () => {
    const store = storeWithJobAt(["shortlisted", "resume-ready", "approved"]);
    expect(() => store.transition("posting-1", "applied", "skip the marker")).toThrow(ScoutError);
    store.transition("posting-1", "submitting", "about to submit");
    expect(store.transition("posting-1", "applied", "confirmation seen").status).toBe("applied");
  });

  it("returns needs-you to the status it came from, and not to another one", () => {
    const store = storeWithJobAt(["shortlisted", "resume-ready"]);
    store.transition("posting-1", "needs-you", "login code needed");
    expect(() => store.transition("posting-1", "approved", "wrong place")).toThrow(ScoutError);
    expect(store.transition("posting-1", "resume-ready", "code entered").status).toBe(
      "resume-ready",
    );
  });

  it("lets needs-you leave to skipped, closed or failed", () => {
    for (const exit of ["skipped", "closed", "failed"] as const) {
      database.exec("DELETE FROM jobs");
      const store = storeWithJobAt(["shortlisted"]);
      store.transition("posting-1", "needs-you", "question");
      expect(store.transition("posting-1", exit, "decided").status).toBe(exit);
    }
  });

  it("forgets the previous status once a job leaves needs-you", () => {
    const store = storeWithJobAt(["shortlisted"]);
    store.transition("posting-1", "needs-you", "question");
    store.transition("posting-1", "shortlisted", "answered");
    store.transition("posting-1", "resume-ready", "built");
    expect(() => store.transition("posting-1", "needs-you", "again")).not.toThrow();
    expect(store.transition("posting-1", "resume-ready", "back").status).toBe("resume-ready");
  });

  it("lets a skipped job be undone to found and closed jobs stay closed", () => {
    const store = storeWithJobAt(["skipped"]);
    expect(store.transition("posting-1", "found", "undo").status).toBe("found");
    store.transition("posting-1", "closed", "posting removed");
    expect(() => store.transition("posting-1", "found", "reopen")).toThrow(ScoutError);
  });
});

describe("a job that was submitted once", () => {
  const approvedPath: JobStatus[] = ["shortlisted", "resume-ready", "approved", "submitting"];

  it("can never be skipped or re-opened, by any route through needs-you or failed", () => {
    const routes: JobStatus[][] = [
      ["needs-you", "skipped"],
      ["failed", "skipped"],
      ["unverified", "needs-you", "skipped"],
      ["unverified", "failed", "skipped"],
      ["applied", "contacted", "closed"],
    ];
    for (const route of routes) {
      database.prepare("DELETE FROM jobs").run();
      const store = storeWithJobAt(approvedPath);
      // Walk as far as the table allows; the last step towards skipped must be refused.
      const last = route[route.length - 1];
      for (const status of route.slice(0, -1)) {
        store.transition("posting-1", status, `step to ${status}`);
      }
      if (last === "skipped") {
        expect(() => store.transition("posting-1", "skipped", "try")).toThrowError(ScoutError);
        expect(store.get("posting-1")?.status).not.toBe("skipped");
      }
    }
  });

  it("can never return to found, shortlisted, resume-ready or approved", () => {
    const store = storeWithJobAt([...approvedPath, "needs-you"]);
    for (const target of ["found", "shortlisted", "resume-ready", "approved"] as const) {
      expect(() => store.transition("posting-1", target, "try")).toThrowError(ScoutError);
    }
  });

  it("still remembers it was submitted after a database upgrade from schema 1", () => {
    const store = storeWithJobAt(approvedPath);
    database.prepare("UPDATE jobs SET ever_submitted = 0").run();
    // Simulates a row written before the column existed: the upgrade step marks submitted jobs.
    database
      .prepare(
        "UPDATE jobs SET ever_submitted = 1 WHERE status IN ('submitting','applied','contacted','interviewing','offer','rejected','withdrawn','unverified')",
      )
      .run();
    store.transition("posting-1", "needs-you", "page asked for a code");
    expect(() => store.transition("posting-1", "skipped", "try")).toThrowError(ScoutError);
  });
});

describe("the digest's approve, skip and undo moves", () => {
  it("allows shortlisted -> approved -> shortlisted and shortlisted -> skipped -> shortlisted", () => {
    const store = storeWithJobAt(["shortlisted"]);
    expect(store.transition("posting-1", "approved", "approved in the digest").status).toBe(
      "approved",
    );
    expect(store.transition("posting-1", "shortlisted", "undo").status).toBe("shortlisted");
    expect(store.transition("posting-1", "skipped", "Wrong location").status).toBe("skipped");
    expect(store.transition("posting-1", "shortlisted", "undo").status).toBe("shortlisted");
  });
});
