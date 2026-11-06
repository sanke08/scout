/**
 * Backups and restore of Scout's data folder.
 *
 * What a backup holds (IDEA 5.16): the profile, the settings, the SQLite database, the job
 * folders with their evidence, and the project notes. It NEVER holds saved browser sessions or
 * browser profile folders (the user's logins are treated like keys, IDEA 5.8) and never any
 * `.env` file. Only the files listed above are copied (an allow list), and a second filter drops
 * session folders and `.env` files anywhere inside the copied folders. Symbolic links are skipped,
 * never followed.
 *
 * Form: a dated folder `scout-backup-YYYY-MM-DD_HHMMSS` inside the destination. It is built under
 * a hidden `.partial` name and renamed when complete, so a backup that is interrupted never looks
 * finished. (A single archive would need a tar writer; a plain folder is simpler to inspect, to
 * copy and to restore by hand, so this module writes a folder.)
 *
 * Database: the copy uses SQLite's `VACUUM INTO` through a connection to the live database. It
 * gives a consistent snapshot even while Scout is running and needs no file-level copy of the
 * `-wal` side files. The connection is opened with the store module's `openDatabase` unless the
 * caller passes one it already holds. (Copying the file while it is open could capture a torn
 * state, so that route is not offered.)
 *
 * Example:
 *   const result = createBackup({ dataDirectory: dataDirectory(), destination: "/Volumes/Backup/scout", now });
 *   // result.path is /Volumes/Backup/scout/scout-backup-2026-11-07_140309
 *   restoreBackup({ backupDirectory: result.path, dataDirectory: "/new/data" });
 * Failure: a destination inside the data folder, a backup folder that already exists, a folder
 * that is not a Scout backup, or a non-empty data folder on restore without `overwrite` throw
 * `ScoutError` with a sentence saying what to change. Nothing is written outside the destination
 * (backup) or the data folder (restore).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ScoutError } from "../shared/index.js";
import { openDatabase } from "../store/index.js";
import type { DatabaseSync } from "../store/index.js";
import { copyFileAtomic, writeTextAtomic } from "./atomic-file.js";
import { backupStamp } from "./time-format.js";

/** The marker file inside every backup; restore refuses a folder without it. */
export const BACKUP_MARKER_NAME = "scout-backup.json";

/** Prefix of a backup folder name. */
export const BACKUP_FOLDER_PREFIX = "scout-backup-";

/** Files copied from the data folder, by name. */
const BACKED_UP_FILES = ["profile.json", "settings.json"];

/** Folders copied from the data folder, by name. */
const BACKED_UP_FOLDERS = ["jobs", "project-notes"];

/** The database file name inside the data folder; it is copied through SQLite, not as a file. */
const DATABASE_FILE_NAME = "scout.sqlite";

/** Names of folders that hold saved logins; never copied, at any depth. */
const EXCLUDED_FOLDER_NAMES = new Set([
  "sessions",
  "session",
  "browser-sessions",
  "browser-profile",
  "browser-profiles",
  "chrome-profile",
  "playwright-profile",
]);

/** True for `.env` and `.env.something`; never copied. */
function isEnvironmentFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

/** What `createBackup` needs. `now` is injected so tests are deterministic. */
export interface CreateBackupOptions {
  /** Scout's data folder (`dataDirectory()`). */
  dataDirectory: string;
  /** The folder the user chose for backups. Created if missing. */
  destination: string;
  now: () => Date;
  /** An open database to snapshot. If missing, the data folder's own database is opened briefly. */
  database?: DatabaseSync;
}

/** What `createBackup` reports. */
export interface BackupResult {
  /** The finished backup folder. */
  path: string;
  /** Paths of everything saved, relative to the backup folder, sorted. */
  files: string[];
}

/** What `restoreBackup` needs. */
export interface RestoreBackupOptions {
  backupDirectory: string;
  dataDirectory: string;
  /** Allow restoring into a data folder that already has files. Off by default. */
  overwrite?: boolean;
}

/** True when `inner` is the same as or inside `outer`. */
function isInside(inner: string, outer: string): boolean {
  const innerPath = resolve(inner);
  const outerPath = resolve(outer);
  return innerPath === outerPath || innerPath.startsWith(outerPath + sep);
}

/** Copies a folder tree, skipping symbolic links, `.env` files and session folders. */
function copyTree(source: string, target: string, saved: string[], root: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source).sort()) {
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);
    const info = lstatSync(sourcePath);
    if (info.isSymbolicLink() || isEnvironmentFile(entry)) {
      continue;
    }
    if (info.isDirectory()) {
      if (!EXCLUDED_FOLDER_NAMES.has(entry.toLowerCase())) {
        copyTree(sourcePath, targetPath, saved, root);
      }
    } else if (info.isFile() && !entry.includes(".tmp-")) {
      copyFileAtomic(sourcePath, targetPath);
      saved.push(relative(root, targetPath).split(sep).join("/"));
    }
  }
}

/** Copies one allowed file if it exists. */
function copyOneFile(source: string, target: string, saved: string[], root: string): void {
  if (existsSync(source) && lstatSync(source).isFile()) {
    copyFileAtomic(source, target);
    saved.push(relative(root, target).split(sep).join("/"));
  }
}

/** Writes a consistent snapshot of the database to `target` with `VACUUM INTO`. */
function snapshotDatabase(
  dataDirectory: string,
  target: string,
  held: DatabaseSync | undefined,
): void {
  const databaseFile = join(dataDirectory, DATABASE_FILE_NAME);
  if (held === undefined && !existsSync(databaseFile)) {
    return;
  }
  const database = held ?? openDatabase(databaseFile);
  try {
    database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    if (held === undefined) {
      database.close();
    }
  }
}

/** Creates one dated backup and returns where it is and what it holds. */
export function createBackup(options: CreateBackupOptions): BackupResult {
  const dataFolder = resolve(options.dataDirectory);
  const destination = resolve(options.destination);
  if (isInside(destination, dataFolder)) {
    throw new ScoutError(
      "invalid-input",
      `The backup destination ${destination} is inside the data folder ${dataFolder}. Choose a folder outside it, such as an external drive or a cloud-synced folder.`,
    );
  }
  if (!existsSync(dataFolder)) {
    throw new ScoutError(
      "not-found",
      `The data folder ${dataFolder} does not exist, so there is nothing to back up.`,
    );
  }
  const finalPath = join(destination, `${BACKUP_FOLDER_PREFIX}${backupStamp(options.now())}`);
  if (existsSync(finalPath)) {
    throw new ScoutError(
      "invalid-input",
      `A backup named ${finalPath} already exists. Wait a second and try again, or choose another destination.`,
    );
  }
  const partialPath = `${finalPath}.partial`;
  rmSync(partialPath, { recursive: true, force: true });
  mkdirSync(partialPath, { recursive: true });
  const saved: string[] = [];
  try {
    for (const name of BACKED_UP_FILES) {
      copyOneFile(join(dataFolder, name), join(partialPath, name), saved, partialPath);
    }
    for (const name of BACKED_UP_FOLDERS) {
      const source = join(dataFolder, name);
      if (existsSync(source) && lstatSync(source).isDirectory()) {
        copyTree(source, join(partialPath, name), saved, partialPath);
      }
    }
    snapshotDatabase(dataFolder, join(partialPath, DATABASE_FILE_NAME), options.database);
    if (existsSync(join(partialPath, DATABASE_FILE_NAME))) {
      saved.push(DATABASE_FILE_NAME);
    }
    saved.sort();
    writeTextAtomic(
      join(partialPath, BACKUP_MARKER_NAME),
      `${JSON.stringify({ createdAt: options.now().toISOString(), files: saved }, null, 2)}\n`,
    );
    renameSync(partialPath, finalPath);
  } catch (error) {
    rmSync(partialPath, { recursive: true, force: true });
    throw error;
  }
  return { path: finalPath, files: saved };
}

/** True when the folder has no entries (or does not exist). */
function isEmptyFolder(path: string): boolean {
  return !existsSync(path) || readdirSync(path).length === 0;
}

/**
 * Restores a backup into a data folder. By default refuses a data folder that already has files.
 * With `overwrite: true`, files that the backup holds replace the ones in the data folder; files
 * the backup does not hold are left alone. Stale SQLite side files (`-wal`, `-shm`) next to a
 * replaced database are removed so the old log cannot be applied to the restored database.
 */
export function restoreBackup(options: RestoreBackupOptions): string[] {
  const backupFolder = resolve(options.backupDirectory);
  const dataFolder = resolve(options.dataDirectory);
  if (!existsSync(join(backupFolder, BACKUP_MARKER_NAME))) {
    throw new ScoutError(
      "invalid-input",
      `The folder ${backupFolder} is not a Scout backup (it has no ${BACKUP_MARKER_NAME}), so nothing was restored.`,
    );
  }
  if (isInside(dataFolder, backupFolder) || isInside(backupFolder, dataFolder)) {
    throw new ScoutError(
      "invalid-input",
      "The backup folder and the data folder must be separate folders, one not inside the other.",
    );
  }
  if (!isEmptyFolder(dataFolder) && options.overwrite !== true) {
    throw new ScoutError(
      "unsafe",
      `The data folder ${dataFolder} already has files, so the restore was refused. Restore into an empty folder, or run it again with overwrite turned on if you are sure.`,
    );
  }
  mkdirSync(dataFolder, { recursive: true });
  const restored: string[] = [];
  for (const name of BACKED_UP_FILES) {
    copyOneFile(join(backupFolder, name), join(dataFolder, name), restored, dataFolder);
  }
  for (const name of BACKED_UP_FOLDERS) {
    const source = join(backupFolder, name);
    if (existsSync(source) && lstatSync(source).isDirectory()) {
      copyTree(source, join(dataFolder, name), restored, dataFolder);
    }
  }
  const databaseSource = join(backupFolder, DATABASE_FILE_NAME);
  if (existsSync(databaseSource)) {
    rmSync(join(dataFolder, `${DATABASE_FILE_NAME}-wal`), { force: true });
    rmSync(join(dataFolder, `${DATABASE_FILE_NAME}-shm`), { force: true });
    copyOneFile(databaseSource, join(dataFolder, DATABASE_FILE_NAME), restored, dataFolder);
  }
  return restored.sort();
}
