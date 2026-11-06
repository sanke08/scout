import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { saveEvidence } from "./evidence.js";
import { snapshotForm } from "./snapshot.js";
import { formHtml, makeTemporaryFolder } from "./test-helpers.js";

const folders: Array<() => void> = [];
afterEach(() => {
  while (folders.length > 0) folders.pop()?.();
});

describe("saveEvidence", () => {
  it("writes the snapshot, values, screenshots, confirmation, timestamps and profile version", () => {
    const folder = makeTemporaryFolder();
    folders.push(folder.remove);
    const directory = join(folder.path, "jobs", "job-1", "evidence");
    const snapshot = snapshotForm(formHtml("lever-style"));
    const written = saveEvidence(directory, {
      snapshot,
      filledValues: { email: "alex.rivera@example.com" },
      screenshotBeforeSubmit: new Uint8Array([1, 2, 3]),
      screenshotAfterSubmit: new Uint8Array([4, 5]),
      confirmationText: "Thank you for applying!",
      startedAt: "2026-03-01T10:00:00.000Z",
      finishedAt: "2026-03-01T10:01:00.000Z",
      profileVersion: 7,
      outcome: "applied",
    });
    for (const path of written) expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(join(directory, "form-snapshot.json"), "utf8"))).toEqual(
      snapshot,
    );
    expect(JSON.parse(readFileSync(join(directory, "filled-values.json"), "utf8"))).toEqual({
      email: "alex.rivera@example.com",
    });
    expect([...readFileSync(join(directory, "screenshot-before-submit.png"))]).toEqual([1, 2, 3]);
    expect(readFileSync(join(directory, "confirmation.txt"), "utf8")).toBe(
      "Thank you for applying!",
    );
    const meta = JSON.parse(readFileSync(join(directory, "evidence.json"), "utf8"));
    expect(meta).toMatchObject({
      startedAt: "2026-03-01T10:00:00.000Z",
      finishedAt: "2026-03-01T10:01:00.000Z",
      profileVersion: 7,
      outcome: "applied",
      formShapeHash: snapshot.hash,
    });
  });

  it("writes only what exists and overwrites on a second save", () => {
    const folder = makeTemporaryFolder();
    folders.push(folder.remove);
    const snapshot = snapshotForm(formHtml("lever-style"));
    const base = {
      snapshot,
      filledValues: {},
      startedAt: "2026-03-01T10:00:00.000Z",
      profileVersion: 1,
    };
    saveEvidence(folder.path, { ...base, outcome: "submitting" });
    expect(existsSync(join(folder.path, "confirmation.txt"))).toBe(false);
    saveEvidence(folder.path, { ...base, outcome: "applied", confirmationText: "Thanks" });
    expect(readFileSync(join(folder.path, "confirmation.txt"), "utf8")).toBe("Thanks");
    expect(JSON.parse(readFileSync(join(folder.path, "evidence.json"), "utf8")).outcome).toBe(
      "applied",
    );
  });

  it("refuses an empty folder path", () => {
    const snapshot = snapshotForm(formHtml("lever-style"));
    expect(() =>
      saveEvidence("  ", {
        snapshot,
        filledValues: {},
        startedAt: "x",
        profileVersion: 1,
        outcome: "x",
      }),
    ).toThrow(ScoutError);
  });
});
