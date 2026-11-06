/**
 * Guards that keep every file operation of this module inside the folder it was given.
 *
 * Why they exist: folder names, file stems and source names can come from posting text or other
 * untrusted places. A name such as `../../.ssh/config` must never leave the jobs folder.
 *
 * Example: `assertSafeName("2026-11-07_Acme_Backend", "folder name")` returns the name;
 * `assertSafeName("../x", "folder name")` throws `ScoutError("unsafe")`.
 * Failure: an unsafe name throws `ScoutError("unsafe")`; nothing is read or written first.
 * Symbolic links inside the data folder are not followed by backups, but other functions here
 * trust the data folder that the user owns.
 */
import { join, resolve, sep } from "node:path";
import { ScoutError } from "../shared/index.js";

/** The longest name accepted, in characters; common file systems allow 255 bytes. */
const LONGEST_NAME = 200;

/**
 * Returns `name` unchanged if it is one plain file or folder name, otherwise throws.
 *
 * A plain name is not empty, is not `.` or `..`, does not start with a dot, contains no slash,
 * backslash or control character, and is at most 200 characters. `description` says what the
 * name is ("folder name", "resume file name") so the error tells the user what was refused.
 */
export function assertSafeName(name: string, description: string): string {
  const hasControlCharacter = [...name].some((character) => character.charCodeAt(0) < 32);
  const isUnsafe =
    name.length === 0 ||
    name.length > LONGEST_NAME ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    hasControlCharacter;
  if (isUnsafe) {
    throw new ScoutError(
      "unsafe",
      `The ${description} "${name.slice(0, 60)}" is not a plain name, so Scout refused to use it. Use a name with no slashes, no leading dot and at most ${LONGEST_NAME} characters.`,
    );
  }
  return name;
}

/**
 * Joins `name` onto `base` and proves the result is directly inside `base`.
 *
 * Example: `resolveInside("/data/jobs", "2026-11-07_Acme_Backend")` is
 * `/data/jobs/2026-11-07_Acme_Backend`. Failure: an unsafe `name` throws `ScoutError("unsafe")`.
 */
export function resolveInside(base: string, name: string, description: string): string {
  const baseFolder = resolve(base);
  const target = join(baseFolder, assertSafeName(name, description));
  if (!target.startsWith(baseFolder + sep)) {
    throw new ScoutError(
      "unsafe",
      `The ${description} "${name.slice(0, 60)}" would leave the folder ${baseFolder}, so Scout refused to use it.`,
    );
  }
  return target;
}
