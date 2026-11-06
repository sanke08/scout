import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobStore, openDatabase } from "../store/index.js";
import { createBackup, restoreBackup } from "./backup.js";
import { createJobFolderManager } from "./job-folder.js";
import { fixedClock, makePosting, makeTemporaryFolder } from "./test-helpers.js";

let temporary: ReturnType<typeof makeTemporaryFolder>;
let dataDirectory: string;
let destination: string;

/** Lists every file under a folder as relative paths, sorted. */
function listAll(folder: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...listAll(join(folder, entry.name), relative));
    } else {
      found.push(relative);
    }
  }
  return found.sort();
}

beforeEach(() => {
  temporary = makeTemporaryFolder();
  dataDirectory = join(temporary.path, "data");
  destination = join(temporary.path, "backups");
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(join(dataDirectory, "profile.json"), '{"fake":"profile"}');
  writeFileSync(join(dataDirectory, "settings.json"), '{"fake":"settings"}');
  writeFileSync(join(dataDirectory, ".env"), "SECRET=not-real");
  const database = openDatabase(join(dataDirectory, "scout.sqlite"));
  createJobStore(database).upsertPosting(makePosting());
  database.close();
  const folders = createJobFolderManager({
    jobsDirectory: join(dataDirectory, "jobs"),
    now: fixedClock(),
  });
  const { path } = folders.ensureJobFolder(makePosting());
  mkdirSync(join(path, "evidence"));
  writeFileSync(join(path, "evidence", "confirmation.txt"), "Thanks for applying");
  writeFileSync(join(path, ".env.local"), "TOKEN=not-real");
  mkdirSync(join(path, "sessions"));
  writeFileSync(join(path, "sessions", "cookies.json"), "cookie");
  mkdirSync(join(dataDirectory, "browser-profile"));
  writeFileSync(join(dataDirectory, "browser-profile", "Cookies"), "cookie");
  mkdirSync(join(dataDirectory, "sessions"));
  writeFileSync(join(dataDirectory, "sessions", "linkedin.json"), "cookie");
  writeFileSync(join(temporary.path, "outside-secret.txt"), "do not copy");
  symlinkSync(join(temporary.path, "outside-secret.txt"), join(dataDirectory, "jobs", "link.txt"));
});
afterEach(() => temporary.remove());

describe("createBackup", () => {
  it("copies profile, settings, database, job folders and evidence into a dated folder", () => {
    const result = createBackup({ dataDirectory, destination, now: fixedClock() });
    expect(result.path).toBe(join(destination, "scout-backup-2026-11-07_100000"));
    const files = listAll(result.path);
    expect(files).toContain("profile.json");
    expect(files).toContain("settings.json");
    expect(files).toContain("scout.sqlite");
    expect(files).toContain("scout-backup.json");
    expect(files).toContain("jobs/2026-11-07_ExampleCorp_Backend-Engineer/job.md");
    expect(files).toContain(
      "jobs/2026-11-07_ExampleCorp_Backend-Engineer/evidence/confirmation.txt",
    );
    expect(result.files).toContain("scout.sqlite");
  });

  it("makes a database snapshot that opens and holds the jobs", () => {
    const result = createBackup({ dataDirectory, destination, now: fixedClock() });
    const copy = openDatabase(join(result.path, "scout.sqlite"));
    expect(createJobStore(copy).list()).toHaveLength(1);
    copy.close();
  });

  it("excludes saved sessions, browser profiles, .env files and symbolic links", () => {
    const result = createBackup({ dataDirectory, destination, now: fixedClock() });
    const files = listAll(result.path);
    for (const file of files) {
      expect(file).not.toMatch(/\.env|sessions|browser-profile|cookies|Cookies|link\.txt/);
    }
    expect(readFileSync(join(result.path, "scout-backup.json"), "utf8")).not.toMatch(
      /\.env|sessions/,
    );
  });

  it("never writes outside the destination and leaves no partial folder", () => {
    const before = listAll(temporary.path).filter((file) => !file.startsWith("backups/"));
    const result = createBackup({ dataDirectory, destination, now: fixedClock() });
    expect(listAll(temporary.path).filter((file) => !file.startsWith("backups/"))).toEqual(before);
    expect(result.path.startsWith(destination)).toBe(true);
    expect(readdirSync(destination)).toEqual(["scout-backup-2026-11-07_100000"]);
  });

  it("refuses a destination inside the data folder and an existing backup of the same second", () => {
    expect(() =>
      createBackup({
        dataDirectory,
        destination: join(dataDirectory, "backups"),
        now: fixedClock(),
      }),
    ).toThrow(/inside the data folder/);
    createBackup({ dataDirectory, destination, now: fixedClock() });
    expect(() => createBackup({ dataDirectory, destination, now: fixedClock() })).toThrow(
      /already exists/,
    );
  });

  it("backs up a data folder that has no database yet", () => {
    const empty = join(temporary.path, "fresh");
    mkdirSync(empty);
    writeFileSync(join(empty, "profile.json"), "{}");
    const result = createBackup({ dataDirectory: empty, destination, now: fixedClock() });
    expect(result.files).toEqual(["profile.json"]);
  });
});

describe("restoreBackup", () => {
  it("restores into an empty data folder with the same files, and no .env or sessions", () => {
    const backup = createBackup({ dataDirectory, destination, now: fixedClock() });
    const fresh = join(temporary.path, "fresh-data");
    const restored = restoreBackup({ backupDirectory: backup.path, dataDirectory: fresh });
    expect(restored).toContain("profile.json");
    expect(readFileSync(join(fresh, "profile.json"), "utf8")).toBe('{"fake":"profile"}');
    const database = openDatabase(join(fresh, "scout.sqlite"));
    expect(createJobStore(database).list()).toHaveLength(1);
    database.close();
    expect(listAll(fresh).join("\n")).not.toMatch(/\.env|sessions|browser-profile/);
  });

  it("refuses to overwrite a non-empty data folder unless told to", () => {
    const backup = createBackup({ dataDirectory, destination, now: fixedClock() });
    const target = join(temporary.path, "busy");
    mkdirSync(target);
    writeFileSync(join(target, "profile.json"), "mine");
    expect(() => restoreBackup({ backupDirectory: backup.path, dataDirectory: target })).toThrow(
      /already has files/,
    );
    expect(readFileSync(join(target, "profile.json"), "utf8")).toBe("mine");
    restoreBackup({ backupDirectory: backup.path, dataDirectory: target, overwrite: true });
    expect(readFileSync(join(target, "profile.json"), "utf8")).toBe('{"fake":"profile"}');
  });

  it("refuses a folder that is not a Scout backup", () => {
    const notBackup = join(temporary.path, "random");
    mkdirSync(notBackup);
    expect(() =>
      restoreBackup({ backupDirectory: notBackup, dataDirectory: join(temporary.path, "x") }),
    ).toThrow(/not a Scout backup/);
    expect(existsSync(join(temporary.path, "x"))).toBe(false);
  });
});
