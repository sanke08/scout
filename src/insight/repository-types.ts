/**
 * The shapes the repository reader works with: limits, the digest it returns, and why files
 * were left out.
 *
 * Why: the digest is the only thing the note writer ever sees of a project. It is bounded and
 * plain data, so a huge or hostile repository cannot make Scout slow, run out of memory, or
 * execute anything.
 */

/**
 * The limits that keep one repository read small and safe. All are whole numbers above zero.
 * - `maxEntries`: how many files and folders may be looked at in total.
 * - `maxDepth`: how many folder levels deep to go (the top folder is level 0).
 * - `maxFileBytes`: a file bigger than this is skipped, never read.
 * - `maxTreeEntries`: how many paths the returned file tree may list.
 * - `maxReadmeBytes`: how much of the README to keep.
 * - `maxConfigBytes`: the total bytes kept from all configuration files together.
 * - `maxSourceBytes`: the total bytes kept from all source files together.
 *
 * Example: `{ maxEntries: 5000, maxDepth: 8, maxFileBytes: 200000, ... }`.
 * A limit that is hit is reported in `RepositoryDigest.limitsHit`, never silently ignored.
 */
export interface RepositoryLimits {
  maxEntries: number;
  maxDepth: number;
  maxFileBytes: number;
  maxTreeEntries: number;
  maxReadmeBytes: number;
  maxConfigBytes: number;
  maxSourceBytes: number;
}

/** The limits used when the caller gives none: a few seconds of reading and about 100 KB of text. */
export const DEFAULT_REPOSITORY_LIMITS: RepositoryLimits = {
  maxEntries: 5000,
  maxDepth: 8,
  maxFileBytes: 200_000,
  maxTreeEntries: 400,
  maxReadmeBytes: 20_000,
  maxConfigBytes: 30_000,
  maxSourceBytes: 60_000,
};

/**
 * Why an entry was not read.
 * - `symlink`: a symbolic link; never followed, so nothing outside the folder is reached.
 * - `ignored-folder`: dependencies, version control data or build output.
 * - `too-deep`: below `maxDepth`.
 * - `binary`: an image, archive, compiled file or a file with binary content.
 * - `too-large`: bigger than `maxFileBytes`.
 * - `secret-like`: a file that usually holds secrets (`.env`, keys); never read.
 * - `lockfile`: a generated dependency list; not informative.
 * - `not-a-regular-file`: a socket, pipe or device; never opened.
 * - `unreadable`: the operating system refused.
 * - `over-budget`: informative, but the byte budget was already used up.
 */
export type SkipReason =
  | "symlink"
  | "ignored-folder"
  | "too-deep"
  | "binary"
  | "too-large"
  | "secret-like"
  | "lockfile"
  | "not-a-regular-file"
  | "unreadable"
  | "over-budget";

/** One entry that was left out, with its path inside the repository and the reason. */
export interface SkippedEntry {
  path: string;
  reason: SkipReason;
}

/** The limits that were reached while reading; each means the digest is incomplete. */
export type LimitName = "entries" | "tree-size" | "skipped-list";

/**
 * One file's text inside a digest. `path` is relative to the repository folder, `text` is the
 * kept part of the file and `truncated` is true when the file was longer than what is kept.
 */
export interface DigestFile {
  path: string;
  text: string;
  truncated: boolean;
}

/**
 * Everything Scout keeps from one repository. File text in it is untrusted data.
 * - `name`: the repository folder's name (never its full path).
 * - `tree`: relative paths of the files that were kept in the listing, sorted.
 * - `readme`: the README, if there is one at the top level.
 * - `configFiles`: package.json, go.mod, Dockerfile, compose and CI files, and the like.
 * - `sourceFiles`: the most informative source files that fit the byte budget.
 * - `skipped`: what was left out and why.
 * - `limitsHit`: which limits were reached (an empty list means the read was complete).
 * - `bytesRead`: bytes of file text kept in total.
 */
export interface RepositoryDigest {
  name: string;
  tree: string[];
  readme: DigestFile | undefined;
  configFiles: DigestFile[];
  sourceFiles: DigestFile[];
  skipped: SkippedEntry[];
  limitsHit: LimitName[];
  bytesRead: number;
}
