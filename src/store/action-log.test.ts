import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { createActionLog } from "./action-log.js";
import { openDatabase } from "./schema.js";
import type { DatabaseSync } from "./sqlite-module.js";
import { makeTemporaryFolder, makeTickingClock } from "./test-helpers.js";

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

describe("action log", () => {
  it("stamps each entry with the clock and returns it", () => {
    const log = createActionLog(database, makeTickingClock());
    const entry = log.append({ actor: "discovery", action: "fetch", detail: "12 postings" });
    expect(entry.at).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.jobId).toBeUndefined();
  });

  it("returns the newest entries first and honours the limit", () => {
    const log = createActionLog(database, makeTickingClock());
    for (let number = 1; number <= 5; number++) {
      log.append({ actor: "test", action: "note", detail: `entry ${number}`, jobId: "job-1" });
    }
    const recent = log.recent(3);
    expect(recent.map((entry) => entry.detail)).toEqual(["entry 5", "entry 4", "entry 3"]);
    expect(recent[0]?.jobId).toBe("job-1");
  });

  it("keeps entries after the database is reopened", () => {
    const path = join(folder.path, "reopen.sqlite");
    const first = openDatabase(path);
    createActionLog(first).append({ actor: "test", action: "note", detail: "kept" });
    first.close();
    const second = openDatabase(path);
    expect(createActionLog(second).recent(1)[0]?.detail).toBe("kept");
    second.close();
  });

  it("rejects a limit that is not a positive whole number", () => {
    const log = createActionLog(database);
    for (const bad of [0, -1, 1.5]) {
      expect(() => log.recent(bad)).toThrow(ScoutError);
    }
  });

  it("has no way to change or delete an entry through its interface", () => {
    expect(Object.keys(createActionLog(database)).sort()).toEqual(["append", "recent"]);
  });
});
