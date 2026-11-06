/**
 * Pulling the first JSON value out of text that may also hold prose or code fences.
 *
 * Why it exists: models often wrap the JSON they were asked for in a sentence or a fenced block.
 * Scout accepts that, but only reads data (`JSON.parse`), never runs anything.
 */

/** Result of a search: the parsed value, or nothing found. */
export type JsonFind = { found: true; value: unknown } | { found: false };

const CLOSER_FOR: Record<string, string> = { "{": "}", "[": "]" };

/**
 * Finds where the object or array that starts at `start` ends, honouring strings and escapes.
 * Example: for text `{"a":"}"} tail` and start 0 it returns 8 (the real closing brace).
 * Returns undefined when the brackets never balance.
 */
function findBalancedEnd(text: string, start: number): number | undefined {
  const expectedClosers: string[] = [];
  let insideString = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (insideString) {
      if (character === "\\") index += 1;
      else if (character === '"') insideString = false;
      continue;
    }
    if (character === '"') insideString = true;
    else if (character === "{" || character === "[") expectedClosers.push(CLOSER_FOR[character]!);
    else if (character === "}" || character === "]") {
      if (expectedClosers.pop() !== character) return undefined;
      if (expectedClosers.length === 0) return index;
    }
  }
  return undefined;
}

/**
 * Returns the first balanced `{...}` or `[...]` in `text` that is valid JSON.
 *
 * Example: "Here you go:\n```json\n{\"score\": 7}\n```" gives `{ found: true, value: { score: 7 } }`.
 * Example: "no data here" gives `{ found: false }`.
 * A brace that is only part of a sentence ("use {x}") is skipped and the search continues.
 */
export function extractFirstJson(text: string): JsonFind {
  for (let start = 0; start < text.length; start += 1) {
    const character = text.charAt(start);
    if (character !== "{" && character !== "[") continue;
    const end = findBalancedEnd(text, start);
    if (end === undefined) continue;
    try {
      return { found: true, value: JSON.parse(text.slice(start, end + 1)) };
    } catch {
      continue;
    }
  }
  return { found: false };
}
