/**
 * Turning plain text and web addresses into text that LaTeX accepts.
 *
 * LaTeX gives ten characters a special meaning. Text from the profile must have them replaced, or
 * the page fails to compile or shows the wrong thing.
 */

/** What each LaTeX-special character becomes. One table, so there is one place to read the rules. */
const SPECIAL_CHARACTER_REPLACEMENTS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/**
 * Makes text safe to place in the body of a LaTeX document.
 *
 * Special characters are escaped in one pass (so a backslash is never escaped twice), the em dash
 * becomes `---`, the en dash `--`, and curly quotes become straight quotes.
 *
 * Example: `escapeLatex("R&D – 50% of C_0")` returns `R\&D -- 50\% of C\_0`.
 * A missing value gives an empty string, so optional profile fields never print "undefined".
 */
export function escapeLatex(text: string | undefined): string {
  if (text === undefined) {
    return "";
  }
  return text
    .replace(
      /[\\&%$#_{}~^]/g,
      (character) => SPECIAL_CHARACTER_REPLACEMENTS[character] ?? character,
    )
    .replace(/\u2014/g, "---")
    .replace(/\u2013/g, "--")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

/**
 * Makes a web address safe inside `\href{...}`, where only `%` and `#` need a backslash.
 *
 * Example: `escapeHref("https://example.com/a#b")` returns `https://example.com/a\#b`.
 */
export function escapeHref(address: string): string {
  return address.replace(/%/g, "\\%").replace(/#/g, "\\#");
}

/**
 * The real address a link points to: `https://` is added when the profile wrote none.
 *
 * Example: `linkTarget("github.com/example-alex")` returns `https://github.com/example-alex`.
 */
export function linkTarget(address: string): string {
  return /^https?:\/\//.test(address) ? address : `https://${address}`;
}

/**
 * The shorter text a reader sees for a link: no protocol and no leading `www.`.
 *
 * Example: `linkDisplay("https://www.linkedin.com/in/example-alex")` returns
 * `linkedin.com/in/example-alex`.
 */
export function linkDisplay(address: string): string {
  return address.replace(/^https?:\/\//, "").replace(/^www\./, "");
}
