/**
 * The record of how each job board has behaved in dry runs, kept in `board-runs.json` in the data
 * folder.
 *
 * Why it exists: IDEA 5.10 says dry-run mode is on for every new board and a board leaves it only
 * after a clean run, and Scenario P says a failing self-test pauses automatic submission for that
 * board. The apply module takes these as plain facts (`boardHasCleanRun`); this store is where the
 * app remembers them between runs. A clean run is counted only when a dry run ended clean (the form
 * was filled and every value read back) or a self-test passed. Nothing else adds to the count.
 *
 * Example: `store.recordCleanDryRun("greenhouse", now)` then `store.hasCleanRun("greenhouse")` is
 * `true`; after `store.recordFailedSelfTest("greenhouse", now)` it is `false` again, and
 * `store.hasFailedSelfTest("greenhouse")` is `true`, until the next clean run clears the failure.
 */
import { z } from "zod";
import { ScoutError } from "../shared/index.js";
import { readJsonFile, writeJsonFile } from "./json-file.js";

/** What is remembered about one board: how many clean runs, when the last one was, any open failure. */
export const boardRunSchema = z.object({
  /** How many dry runs or self-tests ended clean on this board. */
  cleanDryRuns: z.number().int().nonnegative(),
  /** ISO time of the latest clean run. */
  lastCleanRunAt: z.string().optional(),
  /** ISO time of a failed self-test that no clean run has cleared yet. */
  lastFailedAt: z.string().optional(),
});
export type BoardRun = z.infer<typeof boardRunSchema>;

/** The file format: a version number and one entry per board kind (for example `greenhouse`). */
export const boardRunFileSchema = z.object({
  schemaVersion: z.literal(1),
  boards: z.record(z.string(), boardRunSchema),
});
export type BoardRunFile = z.infer<typeof boardRunFileSchema>;

/** Reads and changes the dry-run record of the boards. */
export interface BoardRunStore {
  /** True when the board has at least one clean run and no failed self-test since. */
  hasCleanRun(board: string): boolean;
  /** True when the board's latest self-test failed and no clean run has happened since. */
  hasFailedSelfTest(board: string): boolean;
  /** Counts one clean dry run (or passed self-test) and clears any earlier failure. */
  recordCleanDryRun(board: string, at: Date): void;
  /** Remembers that a self-test failed, so the board counts as having no clean run. */
  recordFailedSelfTest(board: string, at: Date): void;
}

/**
 * Creates the store over the file at `path`.
 * Failure: a damaged or wrongly shaped file gives `invalid-input` naming the path; a file from a
 * newer Scout gives `invalid-input` and is left untouched. A missing file means no board has a
 * clean run yet.
 */
export function createBoardRunStore(path: string): BoardRunStore {
  /** Reads and validates the file; a missing file is an empty record. */
  function readFile(): BoardRunFile {
    const raw = readJsonFile(path, "the board run record");
    if (raw === undefined) return { schemaVersion: 1, boards: {} };
    const parsed = boardRunFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field =
        issue === undefined ? "the file" : issue.path.map(String).join(".") || "the file";
      throw new ScoutError(
        "invalid-input",
        `The board run record at ${path} is not valid (${field}: ${issue?.message ?? "unknown problem"}). It must look like {"schemaVersion": 1, "boards": {"greenhouse": {"cleanDryRuns": 1}}}; delete the file to start again.`,
      );
    }
    return parsed.data;
  }

  /** Changes one board's entry and writes the whole file back. */
  function update(board: string, change: (current: BoardRun) => BoardRun): void {
    const file = readFile();
    const current = file.boards[board] ?? { cleanDryRuns: 0 };
    writeJsonFile(path, { ...file, boards: { ...file.boards, [board]: change(current) } });
  }

  return {
    hasCleanRun(board) {
      const entry = readFile().boards[board];
      return entry !== undefined && entry.cleanDryRuns > 0 && entry.lastFailedAt === undefined;
    },
    hasFailedSelfTest(board) {
      return readFile().boards[board]?.lastFailedAt !== undefined;
    },
    recordCleanDryRun(board, at) {
      update(board, (current) => ({
        cleanDryRuns: current.cleanDryRuns + 1,
        lastCleanRunAt: at.toISOString(),
      }));
    },
    recordFailedSelfTest(board, at) {
      update(board, (current) => ({ ...current, lastFailedAt: at.toISOString() }));
    },
  };
}
