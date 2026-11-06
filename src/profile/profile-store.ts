/**
 * The profile file on disk: load it, validate it, save it with a version number.
 *
 * It exists so every other module reads and writes the one profile the same safe way. The file
 * is plain JSON a person can edit by hand; this module never reformats anything except the
 * indent and never rewrites a file when nothing changed.
 *
 * Example: `createProfileStore("/data/profile.json").save(profile)` writes the file and returns
 * the profile with `version` one higher than the file had, or the same version when the content
 * is identical to what is already saved.
 */
import { existsSync } from "node:fs";
import { profileSchema, ScoutError, type Profile, type ProfileStore } from "../shared/index.js";
import {
  describeFirstIssue,
  readJsonFile,
  refuseNewerSchema,
  writeJsonAtomically,
} from "./json-file.js";
import { assertProfileVariantsAllowed } from "./points.js";

/** The newest `schemaVersion` of the profile file this code understands. */
const SUPPORTED_SCHEMA_VERSION = profileSchema.shape.schemaVersion.value;

/**
 * Checks unknown data against the profile schema.
 *
 * `what` names the data in error sentences, e.g. "the profile file at /data/profile.json".
 * Failure means a field is missing or has the wrong type; the error names the field path.
 */
function parseProfile(raw: unknown, what: string): Profile {
  const result = profileSchema.safeParse(raw);
  if (!result.success) {
    throw new ScoutError("invalid-input", describeFirstIssue(result.error, what));
  }
  return result.data;
}

/**
 * Reads the profile file, or `undefined` when there is none. Refuses a newer file format and
 * an invalid file, in both cases leaving the file untouched.
 */
function readProfileFile(path: string): Profile | undefined {
  const what = `the profile file at ${path}`;
  const raw = readJsonFile(path, "the profile file");
  if (raw === undefined) {
    return undefined;
  }
  refuseNewerSchema(raw, SUPPORTED_SCHEMA_VERSION, "the profile file", path);
  return parseProfile(raw, what);
}

/**
 * True when two profiles hold the same content, ignoring only the version counter.
 *
 * Both are schema-parsed, so their keys come in the same order and the text comparison is
 * reliable. Example: the same profile with `version` 3 and `version` 9 is the same content.
 */
function hasSameContent(first: Profile, second: Profile): boolean {
  return JSON.stringify({ ...first, version: 0 }) === JSON.stringify({ ...second, version: 0 });
}

/**
 * Creates the store for one profile file.
 *
 * `load` throws `not-found` when the file is missing (with how to create one), `invalid-input`
 * when the content is not a valid profile or comes from a newer Scout. `save` validates first,
 * compares with what is on disk, and bumps `version` by exactly one only if the content changed.
 * A first save (no file yet) also counts as a change. A file on disk that is invalid or newer
 * makes `save` fail without overwriting it, so a hand edit is never lost.
 */
export function createProfileStore(path: string): ProfileStore {
  return {
    exists(): boolean {
      return existsSync(path);
    },

    load(): Profile {
      const profile = readProfileFile(path);
      if (profile === undefined) {
        throw new ScoutError(
          "not-found",
          `No profile exists at ${path}. Run Scout's first-run setup, or copy fixtures/profile.sample.json to that path and edit it.`,
        );
      }
      return profile;
    },

    save(profile: Profile): Profile {
      const checked = parseProfile(profile, "the profile being saved");
      assertProfileVariantsAllowed(checked);
      const onDisk = readProfileFile(path);
      if (onDisk === undefined) {
        const first = { ...checked, version: checked.version + 1 };
        writeJsonAtomically(path, first);
        return first;
      }
      if (hasSameContent(onDisk, checked)) {
        return onDisk;
      }
      const next = { ...checked, version: onDisk.version + 1 };
      writeJsonAtomically(path, next);
      return next;
    },
  };
}
