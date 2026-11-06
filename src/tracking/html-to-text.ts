/**
 * Turns the HTML of an email into plain text, keeping link addresses.
 *
 * Why it exists: many emails (especially job-alert digests) have only an HTML part, and the job
 * link lives in the link's address, not in its visible words. The text keeps both.
 *
 * Message HTML is untrusted: this only removes markup. It never loads images, follows links or
 * runs scripts.
 */
import { load } from "cheerio";

/** Elements after which a line break is added so blocks stay on separate lines. */
const BLOCK_SELECTOR =
  "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, table, section, article, blockquote";

/**
 * Returns the readable text of an HTML email body. A link whose address starts with http is
 * written as `words <address>` so a later step can still find the address.
 *
 * Example: `<p>Backend Engineer</p><a href="https://example.com/j/1">View job</a>` becomes
 * `Backend Engineer\nView job <https://example.com/j/1>`.
 * Failure: never throws; text with no markup comes back trimmed.
 */
export function emailHtmlToText(rawHtml: string): string {
  // A browser treats every run of white space in HTML as one space; only tags make line breaks.
  const document = load(rawHtml.replace(/\s+/g, " "), null, false);
  document("script, style, noscript, template, head, title").remove();
  document("a[href]").each((_index, element) => {
    const address = document(element).attr("href") ?? "";
    if (/^https?:\/\//i.test(address)) {
      // `.text()` stores the address as plain text, so the angle brackets are not read as a tag.
      document(element).append(document("<span></span>").text(` <${address}>`));
    }
  });
  document("br").replaceWith("\n");
  document(BLOCK_SELECTOR).each((_index, element) => {
    document(element).append("\n");
  });
  return document
    .root()
    .text()
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
