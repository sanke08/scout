import { describe, expect, it } from "vitest";
import { detectBoard } from "../../discovery/index.js";
import type { BoardEntry, BoardStore } from "../boards-store.js";
import { careersAddressOf, createBoardLookup } from "./mail-board-lookup.js";

/** A board store that only lists the given boards. */
function storeOf(boards: BoardEntry[]): BoardStore {
  return {
    list: () => boards,
    add: (board) => ({ board, added: true }),
    remove: () => undefined,
  };
}

describe("careersAddressOf", () => {
  it("gives an address that discovery reads back as the same board, for every readable kind", () => {
    const kinds = [
      "greenhouse",
      "lever",
      "ashby",
      "workable",
      "smartrecruiters",
      "recruitee",
    ] as const;
    for (const kind of kinds) {
      expect(detectBoard(careersAddressOf({ kind, token: "acme" }))).toEqual({
        kind,
        token: "acme",
      });
    }
    const feed = "https://example.com/jobs.rss";
    expect(detectBoard(careersAddressOf({ kind: "feed", token: feed }))).toEqual({
      kind: "feed",
      token: feed,
    });
  });
});

describe("createBoardLookup", () => {
  const lookup = createBoardLookup(
    storeOf([{ kind: "lever", token: "lakeside", company: "Lakeside Software" }]),
  );

  it("finds a watched company by name, ignoring case and punctuation", async () => {
    expect(await lookup("lakeside-software")).toBe("https://jobs.lever.co/lakeside");
    expect(await lookup("LAKESIDE SOFTWARE")).toBe("https://jobs.lever.co/lakeside");
  });

  it("knows nothing about a company that is not watched, and never guesses", async () => {
    expect(await lookup("Unwatched Inc")).toBeUndefined();
    expect(await lookup("")).toBeUndefined();
  });
});
