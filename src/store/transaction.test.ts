/**
 * Tests of `runInTransaction`: all or nothing, and work nested inside another transaction joins it
 * (so a step that must be atomic can call the job store, which opens its own transaction).
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeTemporaryFolder } from "./test-helpers.js";
import { openDatabase } from "./schema.js";
import { runInTransaction } from "./transaction.js";

describe("runInTransaction", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  /** A database in a temporary folder, removed after the test. */
  function openProbe() {
    const folder = makeTemporaryFolder();
    const database = openDatabase(`${folder.path}/probe.sqlite`);
    cleanups.push(() => {
      database.close();
      folder.remove();
    });
    return database;
  }

  it("keeps everything when the work succeeds and nothing when it throws", () => {
    const database = openProbe();
    database.exec("CREATE TABLE IF NOT EXISTS probe (n INTEGER)");
    runInTransaction(database, () => database.exec("INSERT INTO probe VALUES (1)"));
    expect(() =>
      runInTransaction(database, () => {
        database.exec("INSERT INTO probe VALUES (2)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(database.prepare("SELECT n FROM probe").all()).toEqual([{ n: 1 }]);
  });

  it("lets nested work join the outer transaction, so one failure undoes both", () => {
    const database = openProbe();
    database.exec("CREATE TABLE IF NOT EXISTS probe (n INTEGER)");
    expect(() =>
      runInTransaction(database, () => {
        runInTransaction(database, () => database.exec("INSERT INTO probe VALUES (7)"));
        throw new Error("outer failed");
      }),
    ).toThrow("outer failed");
    expect(database.prepare("SELECT n FROM probe").all()).toEqual([]);
    // A new transaction can start afterwards.
    runInTransaction(database, () => database.exec("INSERT INTO probe VALUES (8)"));
    expect(database.prepare("SELECT n FROM probe").all()).toEqual([{ n: 8 }]);
  });
});
