/**
 * Turns the HTML of a posting into plain text without changing any word.
 *
 * Posting text is untrusted data: this module only removes markup. It never follows links,
 * never runs scripts and never interprets what the text says.
 */
import { load } from "cheerio";

/** Elements after which a line break is added, so paragraphs and list items stay apart. */
const BLOCK_SELECTOR =
  "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote";

/**
 * Some boards send HTML as escaped text (`&lt;p&gt;Hello&lt;/p&gt;`). Returns the real HTML in
 * that case and the input unchanged otherwise.
 */
function unescapeIfEscaped(raw: string): string {
  const looksEscaped = !raw.includes("<") && /&lt;\/?[a-z]/i.test(raw);
  if (!looksEscaped) return raw;
  return load(raw, null, false).root().text();
}

/**
 * Returns the readable text of an HTML fragment. Words are kept exactly as written; list items
 * start with "- " and each block sits on its own line.
 *
 * Example: `<p>Build <b>APIs</b></p><ul><li>Node.js</li></ul>` becomes `Build APIs\n- Node.js`.
 * Failure: never throws; text with no markup comes back trimmed.
 */
export function htmlToText(rawHtml: string): string {
  const document = load(unescapeIfEscaped(rawHtml), null, false);
  document("script, style, noscript, template").remove();
  document("br").replaceWith("\n");
  document("li").each((_index, element) => {
    document(element).prepend("- ");
  });
  document(BLOCK_SELECTOR).each((_index, element) => {
    document(element).append("\n");
  });
  const lines = document
    .root()
    .text()
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
