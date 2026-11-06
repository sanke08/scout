import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBoardStore } from "./boards-store.js";

let directory: string;
let path: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "scout-boards-"));
  path = join(directory, "boards.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("board store", () => {
  it("starts empty when no file exists", () => {
    expect(createBoardStore(path).list()).toEqual([]);
  });

  it("keeps added boards in order and survives reopening", () => {
    const store = createBoardStore(path);
    store.add({ kind: "greenhouse", token: "examplecorp", company: "Example Corp" });
    store.add({ kind: "lever", token: "acme" });
    const reopened = createBoardStore(path).list();
    expect(reopened.map((board) => `${board.kind}:${board.token}`)).toEqual([
      "greenhouse:examplecorp",
      "lever:acme",
    ]);
    expect(reopened[0]?.company).toBe("Example Corp");
  });

  it("treats adding the same board twice (ignoring case) as no change", () => {
    const store = createBoardStore(path);
    expect(store.add({ kind: "lever", token: "Acme" }).added).toBe(true);
    expect(store.add({ kind: "lever", token: "acme" }).added).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it("removes a board, and refuses to remove one that is not listed", () => {
    const store = createBoardStore(path);
    store.add({ kind: "lever", token: "acme" });
    store.remove("lever", "ACME");
    expect(store.list()).toEqual([]);
    expect(() => store.remove("lever", "acme")).toThrowError(/not on your list/);
  });

  it("refuses boards Scout cannot read, with the fix in the message", () => {
    const store = createBoardStore(path);
    expect(() => store.add({ kind: "other", token: "acme" })).toThrowError(/no public feed/);
    expect(() => store.add({ kind: "feed", token: "not-a-link" })).toThrowError(/web address/);
    expect(() => store.add({ kind: "lever", token: "" })).toThrowError(/non-empty token/);
  });

  it("names the file and the problem when the file is damaged or has the wrong shape", () => {
    writeFileSync(path, "{ not json");
    expect(() => createBoardStore(path).list()).toThrowError(/not valid JSON/);
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, boards: [{ kind: "nope", token: "x" }] }),
    );
    expect(() => createBoardStore(path).list()).toThrowError(/board list at .* is not valid/);
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, boards: [] }));
    expect(() => createBoardStore(path).list()).toThrowError(/is not valid/);
  });

  it("writes a file a person can read and edit", () => {
    createBoardStore(path).add({ kind: "ashby", token: "acme" });
    const text = readFileSync(path, "utf8");
    expect(text).toContain('\n  "boards": [');
    expect(JSON.parse(text).schemaVersion).toBe(1);
  });
});
