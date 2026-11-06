/**
 * Turns the resume's LaTeX source into plain readable text for the Digest card.
 *
 * Why it exists: `DigestCard.resumePreview` is shown as plain text, but the resume builder returns
 * LaTeX. This reads only the generated body (the fixed template after `\begin{document}`), so it
 * knows the handful of commands the builder emits; it is not a general LaTeX reader.
 *
 * Example: `\section{Summary}` and `\resumeItem{Built an API.}` become "SUMMARY" and "  - Built an API.".
 */

/** Reads one `{...}` group starting at `start` (which must be `{`); returns its text and the index after it. */
function readGroup(text: string, start: number): { content: string; next: number } {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === "\\") {
      index += 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return { content: text.slice(start + 1, index), next: index + 1 };
    }
  }
  return { content: text.slice(start + 1), next: text.length };
}

/** Reads `count` groups one after another, skipping spaces and line breaks between them. */
function readGroups(
  text: string,
  start: number,
  count: number,
): { groups: string[]; next: number } {
  const groups: string[] = [];
  let index = start;
  for (let found = 0; found < count; found += 1) {
    while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
    if (text.charAt(index) !== "{") break;
    const group = readGroup(text, index);
    groups.push(group.content);
    index = group.next;
  }
  return { groups, next: index };
}

/** Replaces escaped characters and spacing commands inside one piece of text, and unwraps styling commands. */
function cleanInline(source: string): string {
  let text = source;
  text = text.replace(/\\href\{[^}]*\}/g, "");
  text = text.replace(/\\textcolor\{[^}]*\}/g, "");
  text = text.replace(/\$\|\$/g, "|");
  text = text.replace(/\\\\/g, "\n");
  text = text.replace(/\\(vspace|hspace)\*?\{[^}]*\}/g, "");
  text = text.replace(/\\(textbf|emph|underline|textit|scshape|small|Huge|large|Large)\b/g, "");
  text = text.replace(/\\([&%$#_{}])/g, "$1");
  text = text.replace(/\\textasciitilde\{\}/g, "~").replace(/\\textasciicircum\{\}/g, "^");
  text = text.replace(/\\textbackslash\{\}/g, "\uE000");
  text = text.replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?/g, "");
  text = text.replace(/\\[a-zA-Z]+\*?/g, "");
  text = text.replace(/\uE000/g, "\\");
  text = text.replace(/---/g, "—").replace(/--/g, "–");
  text = text.replace(/[{}]/g, "");
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Converts the generated LaTeX source to plain text. Headings are upper-cased, each point starts
 * with "- ", and styling is dropped. Failure: none; an unreadable source gives less text.
 */
export function latexToText(texSource: string): string {
  const documentStart = texSource.indexOf("\\begin{document}");
  const body = documentStart === -1 ? texSource : texSource.slice(documentStart);
  const lines: string[] = [];
  let index = 0;
  let loose = "";
  const flushLoose = (): void => {
    const cleaned = cleanInline(loose);
    if (cleaned !== "") lines.push(cleaned);
    loose = "";
  };
  while (index < body.length) {
    const character = body.charAt(index);
    if (character === "%") {
      const end = body.indexOf("\n", index);
      index = end === -1 ? body.length : end;
      continue;
    }
    const command =
      /^\\(section|resumeItem|resumeSubheading|resumeProjectHeading)(?![a-zA-Z])/.exec(
        body.slice(index, index + 30),
      );
    if (command === null) {
      loose += character;
      index += 1;
      continue;
    }
    flushLoose();
    const name = command[1];
    const { groups, next } = readGroups(
      body,
      index + command[0].length,
      name === "resumeSubheading" ? 4 : name === "resumeProjectHeading" ? 2 : 1,
    );
    const [first = "", second = "", third = "", fourth = ""] = groups.map(cleanInline);
    if (name === "section") lines.push("", first.toUpperCase());
    else if (name === "resumeItem") lines.push(`  - ${first}`);
    else if (name === "resumeSubheading") lines.push(`${first}, ${third} (${second}), ${fourth}`);
    else lines.push(first);
    index = next;
  }
  flushLoose();
  return lines.join("\n").replace(/^\n+/, "");
}
