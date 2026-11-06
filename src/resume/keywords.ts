/**
 * Working with a job's keywords: cleaning them and finding them in text.
 */

/**
 * Cleans the keywords of a job: trimmed, lower-cased, empty ones dropped, duplicates removed, the
 * first appearance kept in place.
 *
 * Example: `normalizeKeywords([" Node.js", "node.js", "", "Kafka"])` returns `["node.js", "kafka"]`.
 */
export function normalizeKeywords(keywords: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const keyword of keywords) {
    const lowered = keyword.trim().toLowerCase();
    if (lowered !== "" && !cleaned.includes(lowered)) {
      cleaned.push(lowered);
    }
  }
  return cleaned;
}

/** Puts a backslash before every character that has a meaning inside a regular expression. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `keyword` appears in `text` as a whole word, ignoring case. A word ends where a
 * letter or digit ends, so "go" is not found in "google" but "node.js" is found in "Node.js,".
 *
 * Example: `containsWholeWord("Built it with Node.js.", "node.js")` is true;
 * `containsWholeWord("Google Cloud", "go")` is false.
 */
export function containsWholeWord(text: string, keyword: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeForPattern(keyword)}(?=$|[^a-z0-9])`, "i");
  return pattern.test(text);
}

/**
 * True when `terms` holds `keyword` (compared without regard to case). Used for a point's
 * `allowed` terms and for skill items.
 *
 * Example: `containsTerm(["Redis", "Go"], "redis")` is true.
 */
export function containsTerm(terms: readonly string[], keyword: string): boolean {
  return terms.some((term) => term.toLowerCase() === keyword);
}
