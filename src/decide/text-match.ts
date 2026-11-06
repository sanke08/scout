/**
 * Small text helpers shared by every rule: lower-casing, whitespace clean-up and whole-word
 * search. Matching whole words keeps "Go" from matching "Google" and "gaming" from matching
 * "engaging".
 *
 * Example: `containsWholeWord("We build on Node.js daily", "node.js")` is `true`;
 * `containsWholeWord("Google", "go")` is `false`.
 */

/**
 * Lower-cases `text`, writes "u.s." as "us" and collapses every run of whitespace to one space.
 * Example: `normaliseText("  Must be a\n U.S. Citizen ")` is `"must be a us citizen"`.
 */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bu\.s\.(?=\W|$)/g, "us")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapes characters that mean something inside a regular expression. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `phrase` appears in `text` as a whole word or whole phrase, ignoring case. A word
 * boundary here means "the next character is not a letter or a digit", so "c++" and "node.js"
 * work. An empty phrase never matches (it would otherwise match everything).
 *
 * Example: `containsWholeWord("Senior Go developer", "go")` is `true`.
 */
export function containsWholeWord(text: string, phrase: string): boolean {
  const wanted = normaliseText(phrase);
  if (wanted === "") return false;
  const pattern = new RegExp(`(?<![a-z0-9])${escapeForPattern(wanted)}(?![a-z0-9])`);
  return pattern.test(normaliseText(text));
}

/**
 * True when `text` contains `phrase` as plain (case-insensitive, whitespace-collapsed) text,
 * not necessarily as a whole word. Used for dealbreaker phrases, which are sentences.
 * An empty phrase never matches.
 *
 * Example: `containsPhrase("Expect on-call   every week.", "on-call every week")` is `true`.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const wanted = normaliseText(phrase);
  return wanted !== "" && normaliseText(text).includes(wanted);
}
