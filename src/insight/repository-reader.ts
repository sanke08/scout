/**
 * Reads one project folder into a bounded `RepositoryDigest`, safely.
 *
 * Why: scenario A reads the user's own projects once. The folder may be large, may contain
 * symbolic links pointing anywhere, secrets, binaries and text written to fool a model. The reader
 * therefore only lists and reads files: it never runs code, never installs anything, never writes
 * inside the repository, never follows a symbolic link, and stops at fixed limits.
 */
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, join } from "node:path";
import { ScoutError } from "../shared/index.js";
import {
  hasBinaryExtension,
  IGNORED_FOLDERS,
  isConfigFile,
  isLockfile,
  isSecretLike,
  isSourceFile,
  isTopLevelReadme,
  sourceScore,
} from "./file-rules.js";
import {
  DEFAULT_REPOSITORY_LIMITS,
  type DigestFile,
  type LimitName,
  type RepositoryDigest,
  type RepositoryLimits,
  type SkippedEntry,
  type SkipReason,
} from "./repository-types.js";

/** The most skipped entries the digest records; further ones set the `skipped-list` limit. */
const MAXIMUM_SKIPPED_ENTRIES = 300;

/** How many leading bytes are checked for a zero byte to detect binary content. */
const BINARY_CHECK_BYTES = 8000;

/** A regular file found while walking and allowed to be read later. */
interface FoundFile {
  /** Path relative to the repository folder, always with `/` separators. */
  path: string;
  absolutePath: string;
  size: number;
}

/** What the walk collects: files to consider, what was skipped and which limits were hit. */
interface WalkResult {
  files: FoundFile[];
  skipped: SkippedEntry[];
  limitsHit: Set<LimitName>;
}

/** Throws when a limit is not a whole number above zero. */
function checkLimits(limits: RepositoryLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ScoutError(
        "invalid-input",
        `The repository limit ${name} must be a whole number above zero, but it is ${String(value)}.`,
      );
    }
  }
}

/** Records one skipped entry, or the fact that the list is full. */
function recordSkip(result: WalkResult, path: string, reason: SkipReason): void {
  if (result.skipped.length >= MAXIMUM_SKIPPED_ENTRIES) {
    result.limitsHit.add("skipped-list");
    return;
  }
  result.skipped.push({ path, reason });
}

/** Decides what to do with one regular file found while walking. */
function considerFile(result: WalkResult, found: FoundFile, limits: RepositoryLimits): void {
  if (isSecretLike(found.path)) {
    recordSkip(result, found.path, "secret-like");
  } else if (isLockfile(found.path)) {
    recordSkip(result, found.path, "lockfile");
  } else if (hasBinaryExtension(found.path)) {
    recordSkip(result, found.path, "binary");
  } else if (found.size > limits.maxFileBytes) {
    recordSkip(result, found.path, "too-large");
  } else {
    result.files.push(found);
  }
}

/**
 * Walks `folder` depth first in name order. Symbolic links, pipes and devices are skipped with a
 * reason and never opened; ignored folders are not entered.
 */
function walk(
  folder: string,
  relativeFolder: string,
  depth: number,
  limits: RepositoryLimits,
  result: WalkResult,
  counter: { seen: number },
): void {
  let names: string[];
  try {
    names = readdirSync(folder).sort();
  } catch {
    recordSkip(result, relativeFolder === "" ? "." : relativeFolder, "unreadable");
    return;
  }
  for (const name of names) {
    if (counter.seen >= limits.maxEntries) {
      result.limitsHit.add("entries");
      return;
    }
    counter.seen += 1;
    const absolutePath = join(folder, name);
    const path = relativeFolder === "" ? name : `${relativeFolder}/${name}`;
    let details;
    try {
      details = lstatSync(absolutePath);
    } catch {
      recordSkip(result, path, "unreadable");
      continue;
    }
    if (details.isSymbolicLink()) {
      recordSkip(result, path, "symlink");
    } else if (details.isDirectory()) {
      if (IGNORED_FOLDERS.has(name)) {
        recordSkip(result, `${path}/`, "ignored-folder");
      } else if (depth + 1 > limits.maxDepth) {
        recordSkip(result, `${path}/`, "too-deep");
      } else {
        walk(absolutePath, path, depth + 1, limits, result, counter);
      }
    } else if (details.isFile()) {
      considerFile(result, { path, absolutePath, size: details.size }, limits);
    } else {
      recordSkip(result, path, "not-a-regular-file");
    }
  }
}

/**
 * Reads up to `maxBytes` bytes from the start of a regular file, refusing to follow a link
 * that appeared after the walk. Returns `undefined` when the file cannot be read or has binary
 * content (a zero byte near the start).
 */
function readExcerpt(
  found: FoundFile,
  maxBytes: number,
): { text: string; truncated: boolean } | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(found.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const wanted = Math.min(found.size, maxBytes);
    const buffer = Buffer.alloc(wanted);
    const got = readSync(descriptor, buffer, 0, wanted, 0);
    const bytes = buffer.subarray(0, got);
    if (bytes.subarray(0, BINARY_CHECK_BYTES).includes(0)) {
      return undefined;
    }
    return { text: bytes.toString("utf8"), truncated: found.size > got };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

/**
 * Reads files in the given order until `budget` bytes are used. A file that does not fit whole is
 * cut to the bytes left (if any are left); files after the budget is gone are skipped as
 * `over-budget`. Returns the kept files and the bytes used.
 */
function readWithinBudget(
  ordered: readonly FoundFile[],
  budget: number,
  result: WalkResult,
): { kept: DigestFile[]; used: number } {
  const kept: DigestFile[] = [];
  let used = 0;
  for (const found of ordered) {
    const remaining = budget - used;
    if (remaining <= 0) {
      recordSkip(result, found.path, "over-budget");
      continue;
    }
    const excerpt = readExcerpt(found, remaining);
    if (excerpt === undefined) {
      recordSkip(result, found.path, "binary");
      continue;
    }
    used += Buffer.byteLength(excerpt.text, "utf8");
    kept.push({ path: found.path, text: excerpt.text, truncated: excerpt.truncated });
  }
  return { kept, used };
}

/** Orders configuration files shallow first, then by path, so the main manifest comes first. */
function configOrder(files: readonly FoundFile[]): FoundFile[] {
  return [...files].sort(
    (left, right) =>
      left.path.split("/").length - right.path.split("/").length ||
      left.path.localeCompare(right.path),
  );
}

/** Orders source files by `sourceScore`, best first, ties by path. */
function sourceOrder(files: readonly FoundFile[]): FoundFile[] {
  return [...files].sort(
    (left, right) =>
      sourceScore(right.path) - sourceScore(left.path) || left.path.localeCompare(right.path),
  );
}

/**
 * Reads the project folder `directory` into a bounded digest.
 *
 * What it does: lists files (skipping links, dependency and build folders, binaries, secrets and
 * big files), keeps the README, the configuration files and the most informative source files up
 * to the byte budgets in `limits`, and reports everything it left out.
 *
 * What it never does: run code, install dependencies, write anything, follow a symbolic link, or
 * read outside `directory`. All file text in the result is untrusted data.
 *
 * Failure: a path that is not a readable folder throws `not-found`; a bad limit throws
 * `invalid-input`. Reaching a limit is not a failure; it is listed in `limitsHit`.
 *
 * Example: `readRepository("/work/pocket-queue", { maxSourceBytes: 20000 })` returns the digest
 * with at most 20000 bytes of source text.
 */
export function readRepository(
  directory: string,
  limitOverrides: Partial<RepositoryLimits> = {},
): RepositoryDigest {
  const limits: RepositoryLimits = { ...DEFAULT_REPOSITORY_LIMITS, ...limitOverrides };
  checkLimits(limits);
  let root: string;
  try {
    root = realpathSync(directory);
    if (!lstatSync(root).isDirectory()) {
      throw new Error("not a folder");
    }
  } catch {
    throw new ScoutError(
      "not-found",
      `Scout could not open ${directory} as a project folder. Give the path of a folder that exists and that you can read.`,
    );
  }

  const result: WalkResult = { files: [], skipped: [], limitsHit: new Set() };
  walk(root, "", 0, limits, result, { seen: 0 });

  const readmeFound = result.files
    .filter((found) => isTopLevelReadme(found.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 1);
  const readmeRead = readWithinBudget(readmeFound, limits.maxReadmeBytes, result);
  const configRead = readWithinBudget(
    configOrder(result.files.filter((found) => isConfigFile(found.path))),
    limits.maxConfigBytes,
    result,
  );
  const sourceRead = readWithinBudget(
    sourceOrder(result.files.filter((found) => isSourceFile(found.path))),
    limits.maxSourceBytes,
    result,
  );

  const allPaths = result.files.map((found) => found.path).sort();
  if (allPaths.length > limits.maxTreeEntries) {
    result.limitsHit.add("tree-size");
  }
  return {
    name: basename(root),
    tree: allPaths.slice(0, limits.maxTreeEntries),
    readme: readmeRead.kept[0],
    configFiles: configRead.kept,
    sourceFiles: sourceRead.kept,
    skipped: result.skipped,
    limitsHit: [...result.limitsHit].sort(),
    bytesRead: readmeRead.used + configRead.used + sourceRead.used,
  };
}
