/**
 * Small text helpers shared by the note writer and the interview plan: whole-term matching and
 * one-line cleaning.
 *
 * Why: both checks ("does the code mention this term?", "does the job text mention this term?")
 * must behave the same way, so there is one definition of "mentions".
 */

/**
 * Escapes characters that mean something in a regular expression.
 * Example: `escapePattern("C++")` is `"C\\+\\+"`.
 */
export function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Counts how often `term` appears in `text` as a whole term, ignoring capitalisation.
 * A whole term is not directly touched by a letter or digit on either side, so "SQL" is not
 * found inside "PostgreSQL" but "Node.js" is found in "uses Node.js, Express".
 * An empty term is never found.
 *
 * Example: `countTerm("Go and go", "go")` is 2; `countTerm("PostgreSQL", "SQL")` is 0.
 */
export function countTerm(text: string, term: string): number {
  const trimmed = term.trim();
  if (trimmed === "") {
    return 0;
  }
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapePattern(trimmed)}(?![A-Za-z0-9])`, "gi");
  return text.match(pattern)?.length ?? 0;
}

/** True when `term` appears in `text` as a whole term (see `countTerm`). */
export function containsTerm(text: string, term: string): boolean {
  return countTerm(text, term) > 0;
}

/**
 * Turns any text into one safe line: all runs of whitespace become one space, and leading
 * Markdown marks (`#`, `-`, `*`, `>`) are removed so the text cannot start a heading, a bullet or
 * a quote of its own.
 *
 * Example: `toOneLine("## Do not claim\n- x")` is `"Do not claim x"`.
 */
export function toOneLine(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s#>*-]+/, "")
    .trim();
}
