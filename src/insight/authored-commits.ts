/**
 * Work-history safety: keeps only the commits the user wrote.
 *
 * Why: the profile may mention work done in an employer's repository, but only the user's own
 * work. A teammate's files must stay unclaimed (idea document 5.2). This module is a pure
 * function over plain text; running `git log` is the caller's job.
 */

/**
 * One commit line from `git log`.
 * - `hash`: the commit id.
 * - `authorName` and `authorEmail`: who wrote it.
 * - `subject`: the first line of the message.
 */
export interface CommitRecord {
  hash: string;
  authorName: string;
  authorEmail: string;
  subject: string;
}

/**
 * One way the user appears in a git history. Give the email when there is one: it is the
 * stronger evidence. Give only a name when no email is known.
 * Example: `{ name: "Alex Rivera", email: "alex.rivera@example.com" }`.
 */
export interface UserIdentity {
  name?: string;
  email?: string;
}

/**
 * Reads one line in the format `hash<TAB>author name<TAB>author email<TAB>subject`, which is what
 * `git log --format=%H%x09%an%x09%ae%x09%s` prints. The subject may itself contain tabs.
 * Returns `undefined` for a blank or malformed line, so a line Scout cannot read is never counted
 * as the user's.
 */
export function parseCommitLine(line: string): CommitRecord | undefined {
  const fields = line.replace(/\r$/, "").split("\t");
  const [hash, authorName, authorEmail, ...subjectParts] = fields;
  if (hash === undefined || authorName === undefined || authorEmail === undefined) {
    return undefined;
  }
  if (hash.trim() === "" || subjectParts.length === 0) {
    return undefined;
  }
  return {
    hash: hash.trim(),
    authorName: authorName.trim(),
    authorEmail: authorEmail.trim().replace(/^<|>$/g, ""),
    subject: subjectParts.join("\t").trim(),
  };
}

/** Lower-cases and collapses spaces so "Alex  Rivera" equals "alex rivera". */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when the commit belongs to the identity. An identity with an email matches by email only
 * (a teammate who happens to share the user's name does not match). An identity with only a name
 * matches by name. An identity with neither matches nothing.
 */
function commitMatches(commit: CommitRecord, identity: UserIdentity): boolean {
  const email = normalise(identity.email ?? "");
  if (email !== "") {
    return normalise(commit.authorEmail) === email;
  }
  const name = normalise(identity.name ?? "");
  return name !== "" && normalise(commit.authorName) === name;
}

/**
 * Returns only the commits the user authored, in the order given.
 *
 * `gitLogLines` are lines as described at `parseCommitLine`; blank and malformed lines are
 * ignored. `identities` lists every way the user appears (work email, personal email, an old name).
 * Commits only co-authored by the user (a trailer in the message) are not counted: the author
 * field is the evidence.
 *
 * Example: lines by "Alex Rivera <alex.rivera@example.com>" and "Sam Lee <sam.lee@example.com>"
 * with the identity of Alex give only Alex's commit.
 */
export function authoredByUser(
  gitLogLines: readonly string[],
  identities: readonly UserIdentity[],
): CommitRecord[] {
  const authored: CommitRecord[] = [];
  for (const line of gitLogLines) {
    const commit = parseCommitLine(line);
    if (commit !== undefined && identities.some((identity) => commitMatches(commit, identity))) {
      authored.push(commit);
    }
  }
  return authored;
}
