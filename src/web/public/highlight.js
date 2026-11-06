/**
 * Highlighting of matched keywords inside a piece of text. The result is a list of segments, so
 * the caller builds elements from it and no text is ever treated as markup.
 */
import { h } from "./dom.js";

/** Escapes characters that mean something inside a regular expression. */
function escapeForPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cuts `text` into pieces, marking the ones that equal a keyword (case-insensitive, whole word).
 * Example: `splitByKeywords("Built Node.js APIs", ["node.js"])` is
 * `[{ text: "Built ", match: false }, { text: "Node.js", match: true }, { text: " APIs", match: false }]`.
 * With no keywords the whole text is one unmatched piece.
 */
export function splitByKeywords(text, keywords) {
  const wanted = keywords.filter((keyword) => keyword.length > 0);
  if (wanted.length === 0) return text.length > 0 ? [{ text, match: false }] : [];
  const alternatives = [...wanted]
    .sort((first, second) => second.length - first.length)
    .map(escapeForPattern)
    .join("|");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])(${alternatives})(?=$|[^A-Za-z0-9])`, "gi");
  const pieces = [];
  let cursor = 0;
  let found = pattern.exec(text);
  while (found !== null) {
    const start = found.index + (found[1] ?? "").length;
    const matchedText = found[2] ?? "";
    if (start > cursor) pieces.push({ text: text.slice(cursor, start), match: false });
    pieces.push({ text: matchedText, match: true });
    cursor = start + matchedText.length;
    found = pattern.exec(text);
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), match: false });
  return pieces;
}

/**
 * Builds the nodes for `text` with matched keywords wrapped in `<mark>`.
 * Example: `highlightedNodes("Used Kafka", ["Kafka"])` is a text node and a mark element.
 */
export function highlightedNodes(text, keywords) {
  return splitByKeywords(text, keywords).map((piece) =>
    piece.match ? h("mark", { text: piece.text }) : piece.text,
  );
}
