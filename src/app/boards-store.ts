/**
 * The list of company job boards Scout watches, kept in `boards.json` in the data folder.
 *
 * Why it exists: scenario D starts from "a list of forty companies and the kind of job board each
 * uses". The list is a plain file the user can also edit by hand; this store reads it, checks it
 * and changes it safely.
 *
 * Example: `store.add({ kind: "greenhouse", token: "examplecorp" })` then `store.list()` gives
 * `[{ kind: "greenhouse", token: "examplecorp" }]`.
 */
import { z } from "zod";
import { boardKindSchema, ScoutError } from "../shared/index.js";
import { readJsonFile, writeJsonFile } from "./json-file.js";

/**
 * One watched board: the kind of board software, the token that names the company on it (for an
 * RSS feed the token is the feed address) and an optional display name.
 */
export const boardEntrySchema = z.object({
  kind: boardKindSchema,
  token: z.string().min(1),
  company: z.string().min(1).optional(),
});
export type BoardEntry = z.infer<typeof boardEntrySchema>;

/** The file format: a version number and the list. A newer version is refused, never rewritten. */
const boardFileSchema = z.object({
  schemaVersion: z.literal(1),
  boards: z.array(boardEntrySchema),
});

/** Reads and changes the list of watched boards. */
export interface BoardStore {
  /** All watched boards in the order they were added. An empty list when no file exists yet. */
  list(): BoardEntry[];
  /**
   * Adds a board. Adding one that is already listed (same kind and token) changes nothing and
   * reports `added: false`, so running a setup script twice is safe.
   */
  add(board: BoardEntry): { board: BoardEntry; added: boolean };
  /** Removes the board with this kind and token. Throws `not-found` when it is not listed. */
  remove(kind: BoardEntry["kind"], token: string): void;
}

/** True when two entries name the same board. Tokens are compared ignoring case. */
function isSameBoard(first: BoardEntry, kind: BoardEntry["kind"], token: string): boolean {
  return first.kind === kind && first.token.toLowerCase() === token.toLowerCase();
}

/**
 * Checks a board before it is stored: kind "other" has no public feed, and a feed token must be a
 * web address. Throws `ScoutError("invalid-input")` with the fix.
 */
function assertReadableBoard(board: BoardEntry): void {
  if (board.kind === "other") {
    throw new ScoutError(
      "invalid-input",
      'Boards of kind "other" have no public feed format. Use greenhouse, lever, ashby, workable, smartrecruiters, recruitee or feed.',
    );
  }
  if (board.kind === "feed" && !/^https?:\/\//i.test(board.token)) {
    throw new ScoutError(
      "invalid-input",
      `A feed board needs a web address starting with http:// or https://, but you gave "${board.token}".`,
    );
  }
}

/**
 * Creates the board store over the file at `path`.
 * Failure: a damaged or wrongly shaped file gives `invalid-input` naming the path and the field;
 * a file from a newer Scout gives `invalid-input` and is left untouched.
 */
export function createBoardStore(path: string): BoardStore {
  /** Reads and validates the file; a missing file is an empty list. */
  function readBoards(): BoardEntry[] {
    const raw = readJsonFile(path, "the board list");
    if (raw === undefined) return [];
    const parsed = boardFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field =
        issue === undefined ? "the file" : issue.path.map(String).join(".") || "the file";
      throw new ScoutError(
        "invalid-input",
        `The board list at ${path} is not valid (${field}: ${issue?.message ?? "unknown problem"}). It must look like {"schemaVersion": 1, "boards": [{"kind": "greenhouse", "token": "examplecorp"}]}.`,
      );
    }
    return parsed.data.boards;
  }

  /** Writes the list back with the format version. */
  function writeBoards(boards: BoardEntry[]): void {
    writeJsonFile(path, { schemaVersion: 1, boards });
  }

  return {
    list: readBoards,
    add(input) {
      const board = boardEntrySchema.safeParse(input);
      if (!board.success) {
        throw new ScoutError(
          "invalid-input",
          "A board needs a kind (for example greenhouse) and a non-empty token.",
        );
      }
      assertReadableBoard(board.data);
      const boards = readBoards();
      const existing = boards.find((other) =>
        isSameBoard(other, board.data.kind, board.data.token),
      );
      if (existing !== undefined) return { board: existing, added: false };
      writeBoards([...boards, board.data]);
      return { board: board.data, added: true };
    },
    remove(kind, token) {
      const boards = readBoards();
      const remaining = boards.filter((other) => !isSameBoard(other, kind, token));
      if (remaining.length === boards.length) {
        throw new ScoutError(
          "not-found",
          `The board ${kind}:${token} is not on your list. Run "scout boards list" to see the boards you watch.`,
        );
      }
      writeBoards(remaining);
    },
  };
}
