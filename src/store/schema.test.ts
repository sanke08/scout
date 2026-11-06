import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_UPGRADE_STEPS,
  openDatabase,
  readSchemaVersion,
  upgradeDatabase,
} from "./schema.js";
import { DatabaseSync } from "./sqlite-module.js";
import { makeTemporaryFolder } from "./test-helpers.js";

let folder: ReturnType<typeof makeTemporaryFolder>;
beforeEach(() => {
  folder = makeTemporaryFolder();
});
afterEach(() => {
  folder.remove();
});

describe("openDatabase", () => {
  it("creates the parent folder and a database at the newest version", () => {
    const database = openDatabase(join(folder.path, "deep", "nested", "scout.sqlite"));
    expect(readSchemaVersion(database)).toBe(CURRENT_SCHEMA_VERSION);
    database.close();
  });

  it("keeps data when the database is reopened and does not repeat upgrades", () => {
    const path = join(folder.path, "scout.sqlite");
    const first = openDatabase(path);
    first.exec(
      "INSERT INTO action_log (at, actor, action, detail) VALUES ('t', 'test', 'note', 'kept')",
    );
    first.close();
    const second = openDatabase(path);
    const rows = second.prepare("SELECT detail FROM action_log").all();
    expect(rows.map((row) => row["detail"])).toEqual(["kept"]);
    expect(readSchemaVersion(second)).toBe(CURRENT_SCHEMA_VERSION);
    second.close();
  });

  it("refuses a database written by a newer Scout and leaves the file untouched", () => {
    const path = join(folder.path, "scout.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    raw.exec(`INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION + 5})`);
    raw.close();
    const before = readFileSync(path);

    try {
      openDatabase(path);
      expect.unreachable("a newer database must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ScoutError);
      expect((error as ScoutError).message).toContain(String(CURRENT_SCHEMA_VERSION + 5));
    }
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});

describe("upgradeDatabase", () => {
  it("runs only the steps a database has not seen and keeps its data", () => {
    const database = new DatabaseSync(":memory:");
    upgradeDatabase(database, SCHEMA_UPGRADE_STEPS);
    database.exec(
      "INSERT INTO action_log (at, actor, action, detail) VALUES ('t', 'test', 'note', 'old row')",
    );

    const extraStep = {
      version: CURRENT_SCHEMA_VERSION + 1,
      summary: "Add a note column.",
      apply(target: DatabaseSync) {
        target.exec("ALTER TABLE action_log ADD COLUMN note TEXT");
      },
    };
    upgradeDatabase(database, [...SCHEMA_UPGRADE_STEPS, extraStep]);

    expect(readSchemaVersion(database)).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(database.prepare("SELECT detail, note FROM action_log").all()).toEqual([
      { detail: "old row", note: null },
    ]);
    database.close();
  });

  it("rolls back a step that fails and keeps the old version", () => {
    const database = new DatabaseSync(":memory:");
    upgradeDatabase(database, SCHEMA_UPGRADE_STEPS);
    const brokenStep = {
      version: CURRENT_SCHEMA_VERSION + 1,
      summary: "Breaks halfway.",
      apply(target: DatabaseSync) {
        target.exec("ALTER TABLE action_log ADD COLUMN half_done TEXT");
        throw new Error("boom");
      },
    };
    expect(() => upgradeDatabase(database, [...SCHEMA_UPGRADE_STEPS, brokenStep])).toThrow("boom");
    expect(readSchemaVersion(database)).toBe(CURRENT_SCHEMA_VERSION);
    const columns = database.prepare("PRAGMA table_info(action_log)").all();
    expect(columns.map((column) => column["name"])).not.toContain("half_done");
    database.close();
  });

  it("refuses a database newer than the steps it was given", () => {
    const database = new DatabaseSync(":memory:");
    upgradeDatabase(database, SCHEMA_UPGRADE_STEPS);
    expect(() => upgradeDatabase(database, [])).toThrow(ScoutError);
    database.close();
  });
});
