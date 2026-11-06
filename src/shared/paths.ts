/**
 * Where Scout keeps the user's real data. Real data never lives in the repository.
 *
 * The data folder is `SCOUT_DATA_DIR` if set, otherwise `./data` under the current directory.
 * It is git-ignored. Tests must point `SCOUT_DATA_DIR` at a temporary folder.
 *
 * Example: with `SCOUT_DATA_DIR=/tmp/scout`, `profilePath()` is `/tmp/scout/profile.json`.
 */
import { join, resolve } from "node:path";

/** Absolute path of the data folder. */
export function dataDirectory(): string {
  return resolve(process.env["SCOUT_DATA_DIR"] ?? join(process.cwd(), "data"));
}

/** The editable profile file (plain JSON the user can read and edit). */
export function profilePath(): string {
  return join(dataDirectory(), "profile.json");
}

/** The settings file; the Settings view and this file are one store. */
export function settingsPath(): string {
  return join(dataDirectory(), "settings.json");
}

/** The SQLite database file for jobs and the action log. */
export function databasePath(): string {
  return join(dataDirectory(), "scout.sqlite");
}

/** One folder per job: job description, resume sent, evidence. */
export function jobsDirectory(): string {
  return join(dataDirectory(), "jobs");
}

/** Verified notes about the user's own projects, written once per project. */
export function projectNotesDirectory(): string {
  return join(dataDirectory(), "project-notes");
}
