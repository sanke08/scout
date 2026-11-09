/**
 * The record of sign-ins per platform: `<data>/platform-sessions.json`.
 *
 * Why it exists: Scout must know when the user last signed in by hand, when it last signed in
 * itself (and failed), which username is stored in the keychain, and so must never try twice in
 * six hours. It holds no secret: the username is not secret and the password is never here.
 *
 * Example: `store.update("linkedin", { lastManualLoginAt: "2026-11-09T10:00:00.000Z" })` and then
 * `store.get("linkedin")?.lastManualLoginAt` gives the same text back. Every write goes through a
 * temporary file and a rename, so a crash never leaves half a file.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ScoutError } from "../shared/index.js";

/** What Scout remembers about one platform. Every field is optional because none exists until it happens. */
export const platformSessionSchema = z.object({
  /** The username stored in the keychain (never the password). */
  username: z.string().optional(),
  /** When the user last said they had signed in by hand (ISO time). */
  lastManualLoginAt: z.string().optional(),
  /** When Scout last signed in by itself and the site accepted it (ISO time). */
  lastAutoLoginAt: z.string().optional(),
  /** When Scout last started an automatic sign-in that did not end in a signed-in page (ISO time). */
  lastAutoLoginFailedAt: z.string().optional(),
});
/** The TypeScript type of one platform's record. */
export type PlatformSession = z.infer<typeof platformSessionSchema>;

/** The whole file. */
const sessionFileSchema = z.object({
  schemaVersion: z.literal(1),
  platforms: z.record(z.string(), platformSessionSchema),
});

/** Reads and writes the records. */
export interface SessionStore {
  /** The record of one platform, or `undefined` when nothing is known. */
  get(platform: string): PlatformSession | undefined;
  /** Every platform that has a record, by name. */
  list(): Record<string, PlatformSession>;
  /** Merges `changes` into the platform's record and saves. A field set to `undefined` is removed. */
  update(
    platform: string,
    changes: { [Key in keyof PlatformSession]: PlatformSession[Key] | undefined },
  ): void;
  /**
   * Forgets the sign-in times of a platform. Keeps the username (the keychain item still exists) and
   * the time of a failed automatic sign-in, so logging out never lifts the wait after a failure.
   */
  clearSignIns(platform: string): void;
  /** Deletes the whole record of a platform, username included. */
  remove(platform: string): void;
}

/** Reads the file; a missing file is an empty record. Failure: damaged JSON gives `ScoutError("invalid-input")`. */
function readFile(path: string): Record<string, PlatformSession> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ScoutError(
      "unavailable",
      `Scout could not read the platform sign-in record at ${path}. Check that the file is readable.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = sessionFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ScoutError(
      "invalid-input",
      `The platform sign-in record at ${path} is damaged. Delete the file to start again; your keychain items are not affected.`,
    );
  }
  return parsed.data.platforms;
}

/** Writes the file atomically. Failure: an unwritable folder gives `ScoutError("unavailable")`. */
function writeFile(path: string, platforms: Record<string, PlatformSession>): void {
  const temporaryPath = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: 1, platforms }, null, 2)}\n`,
      "utf8",
    );
    renameSync(temporaryPath, path);
  } catch {
    rmSync(temporaryPath, { force: true });
    throw new ScoutError(
      "unavailable",
      `Scout could not write ${path}. Check that the folder is writable.`,
    );
  }
}

/** Creates the store for the file at `path`. */
export function createSessionStore(path: string): SessionStore {
  return {
    get: (platform) => readFile(path)[platform],
    list: () => readFile(path),
    update(platform, changes) {
      const platforms = readFile(path);
      const merged: Record<string, string | undefined> = { ...platforms[platform], ...changes };
      const cleaned: PlatformSession = {};
      for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) cleaned[key as keyof PlatformSession] = value;
      }
      platforms[platform] = cleaned;
      writeFile(path, platforms);
    },
    clearSignIns(platform) {
      const platforms = readFile(path);
      const current = platforms[platform];
      if (current === undefined) return;
      const kept: PlatformSession = {};
      if (current.username !== undefined) kept.username = current.username;
      if (current.lastAutoLoginFailedAt !== undefined) {
        kept.lastAutoLoginFailedAt = current.lastAutoLoginFailedAt;
      }
      platforms[platform] = kept;
      writeFile(path, platforms);
    },
    remove(platform) {
      const platforms = readFile(path);
      if (platforms[platform] === undefined) return;
      delete platforms[platform];
      writeFile(path, platforms);
    },
  };
}
