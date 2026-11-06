/**
 * Turns a `RepositoryDigest` into text: the evidence text that claims are checked against, and
 * the block of text handed to the model as untrusted data.
 *
 * Why: "is this stack term really in the project?" must be answered from the same text the model
 * saw, and only from configuration and code, never from the README (a README can say anything).
 */
import type { RepositoryDigest } from "./repository-types.js";

/**
 * The text a claim must be found in: all configuration files and source files, nothing else.
 * The README is left out on purpose, because the note exists to check the README against code.
 *
 * Example: a digest whose package.json lists "express" gives text containing "express".
 */
export function evidenceText(digest: RepositoryDigest): string {
  return [...digest.configFiles, ...digest.sourceFiles].map((file) => file.text).join("\n");
}

/**
 * Renders the whole digest as one block for the model: file tree, README, configuration, then
 * source. Every file starts with a line naming its path. The whole block is passed as
 * `untrustedText`, so nothing in it can act as an instruction.
 */
export function digestForModel(digest: RepositoryDigest): string {
  const parts: string[] = [`PROJECT FOLDER: ${digest.name}`, "", "FILE TREE:", ...digest.tree];
  if (digest.readme !== undefined) {
    parts.push("", `README (${digest.readme.path}):`, digest.readme.text);
  }
  for (const file of digest.configFiles) {
    parts.push("", `CONFIG FILE ${file.path}:`, file.text);
  }
  for (const file of digest.sourceFiles) {
    parts.push("", `SOURCE FILE ${file.path}:`, file.text);
  }
  if (digest.limitsHit.length > 0 || digest.skipped.length > 0) {
    parts.push(
      "",
      `NOTE: this is a partial view; ${digest.skipped.length} entries were skipped and limits reached: ${digest.limitsHit.join(", ") || "none"}.`,
    );
  }
  return parts.join("\n");
}
