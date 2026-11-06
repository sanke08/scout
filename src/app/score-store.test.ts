import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScoreStore, type StoredScore } from "./score-store.js";

let directory: string;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "scout-scores-"));
  path = join(directory, "scores.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A fictional stored score for the given profile version. */
function makeScore(profileVersion: number): StoredScore {
  return {
    profileVersion,
    shortlistScore: 80,
    eligibility: 80,
    desirability: 80,
    reasons: ["Fits."],
    unmet: [],
    unknown: [],
    redFlags: [],
    engine: "fake",
    scoredAt: "2026-11-07T10:00:00.000Z",
  };
}

describe("score store", () => {
  it("finds nothing before anything is saved", () => {
    expect(createScoreStore(path).find("a", 1)).toBeUndefined();
  });

  it("returns a saved score, also after reopening", () => {
    createScoreStore(path).save("a", makeScore(1));
    expect(createScoreStore(path).find("a", 1)).toEqual(makeScore(1));
  });

  it("does not return a score made for another profile version", () => {
    const store = createScoreStore(path);
    store.save("a", makeScore(1));
    expect(store.find("a", 2)).toBeUndefined();
  });

  it("keeps the other scores when one is saved or replaced", () => {
    const store = createScoreStore(path);
    store.save("a", makeScore(1));
    store.save("b", makeScore(1));
    store.save("a", { ...makeScore(1), shortlistScore: 10 });
    expect(store.find("b", 1)).toEqual(makeScore(1));
    expect(store.find("a", 1)?.shortlistScore).toBe(10);
  });

  it("tells the user to delete a damaged file", () => {
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, scores: { a: { nope: true } } }));
    expect(() => createScoreStore(path).find("a", 1)).toThrowError(/Delete it/);
  });
});
