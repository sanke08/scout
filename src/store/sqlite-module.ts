/**
 * Loads Node's built-in SQLite module without printing its "experimental" warning.
 *
 * Why it exists: `node:sqlite` is marked experimental, and Node prints a warning the first time it
 * is loaded. That warning would appear in the middle of every Scout command. We drop only that one
 * warning while the module loads; every other warning still reaches the user.
 *
 * Example: `import { DatabaseSync } from "./sqlite-module.js"` gives the same class as
 * `node:sqlite`, with no warning on screen.
 * Failure: if this Node version has no `node:sqlite`, the import fails and Scout cannot start; the
 * `engines` field of package.json asks for Node 24 or newer.
 */
import type * as SqliteModule from "node:sqlite";

/** True for the one warning Node prints when `node:sqlite` is loaded. */
function isSqliteExperimentalWarning(warning: unknown, type: unknown): boolean {
  const text = warning instanceof Error ? warning.message : String(warning);
  const kind = warning instanceof Error ? warning.name : String(type);
  return kind === "ExperimentalWarning" && text.includes("SQLite");
}

/** Imports `node:sqlite` while the experimental warning is filtered out, then restores warnings. */
async function loadQuietly(): Promise<typeof SqliteModule> {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, rest[0])) {
      return;
    }
    return (originalEmitWarning as (...arguments_: unknown[]) => void).call(
      process,
      warning,
      ...rest,
    );
  }) as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

const sqlite = await loadQuietly();

/** The SQLite database class of Node, re-exported so no other file imports `node:sqlite` itself. */
export const DatabaseSync = sqlite.DatabaseSync;

/** The type of an open SQLite database. */
export type DatabaseSync = SqliteModule.DatabaseSync;
