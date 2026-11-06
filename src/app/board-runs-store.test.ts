import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardRunStore } from "./board-runs-store.js";

const folders: string[] = [];
afterEach(() => {
  while (folders.length > 0) rmSync(folders.pop() as string, { recursive: true, force: true });
});

/** A path for the record inside a fresh temporary folder. */
function recordPath(): string {
  const folder = mkdtempSync(join(tmpdir(), "scout-board-runs-"));
  folders.push(folder);
  return join(folder, "board-runs.json");
}

const EARLIER = new Date("2026-11-06T10:00:00.000Z");
const LATER = new Date("2026-11-07T10:00:00.000Z");

describe("board run store", () => {
  it("knows no board has a clean run before anything was recorded", () => {
    const store = createBoardRunStore(recordPath());
    expect(store.hasCleanRun("greenhouse")).toBe(false);
    expect(store.hasFailedSelfTest("greenhouse")).toBe(false);
  });

  it("counts a clean run only for the board it was recorded on, and keeps it between opens", () => {
    const path = recordPath();
    createBoardRunStore(path).recordCleanDryRun("greenhouse", EARLIER);
    const reopened = createBoardRunStore(path);
    expect(reopened.hasCleanRun("greenhouse")).toBe(true);
    expect(reopened.hasCleanRun("lever")).toBe(false);
  });

  it("takes the clean-run flag away on a failed self-test until a later clean run", () => {
    const store = createBoardRunStore(recordPath());
    store.recordCleanDryRun("greenhouse", EARLIER);
    store.recordFailedSelfTest("greenhouse", LATER);
    expect(store.hasCleanRun("greenhouse")).toBe(false);
    expect(store.hasFailedSelfTest("greenhouse")).toBe(true);
    store.recordCleanDryRun("greenhouse", LATER);
    expect(store.hasCleanRun("greenhouse")).toBe(true);
    expect(store.hasFailedSelfTest("greenhouse")).toBe(false);
  });

  it("never counts a failure as a clean run", () => {
    const store = createBoardRunStore(recordPath());
    store.recordFailedSelfTest("ashby", EARLIER);
    expect(store.hasCleanRun("ashby")).toBe(false);
  });

  it("refuses a damaged or newer file with a sentence that names the file, and leaves it alone", () => {
    const path = recordPath();
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, boards: {} }));
    expect(() => createBoardRunStore(path).hasCleanRun("greenhouse")).toThrow(/board run record/);
    expect(() => createBoardRunStore(path).recordCleanDryRun("greenhouse", LATER)).toThrow(path);
  });
});
