/**
 * Turns the LaTeX source of a resume into plain lines for the on-page preview sheet. The page
 * never builds resumes itself: the server returns the LaTeX, and this file only reads it back as
 * text so the user can see roughly how the page will look.
 *
 * Output lines have a kind: `heading` (a section title), `bullet` (one resume item), `entry` (a
 * job or project line, with `text` and `aside` for the right-hand side) and `text`.
 * Example: `\section{Skills}` then `\resumeItem{Built APIs}` gives a heading line "Skills" and a
 * bullet line "Built APIs".
 */

/**
 * Reads a `{...}` group starting at or after `start` (spaces and line breaks may come first).
 * Returns the text inside and the index just past the closing brace; when no group follows,
 * returns an empty text and `start` unchanged.
 * Example: `readGroup("{a{b}} rest", 0)` is `{ content: "a{b}", end: 6 }`.
 */
export function readGroup(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  if (source[index] !== "{") return { content: "", end: start };
  let depth = 0;
  const contentStart = index + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return { content: source.slice(contentStart, index), end: index + 1 };
    }
    index += 1;
  }
  return { content: source.slice(contentStart), end: source.length };
}

/** Collapses runs of spaces, tabs and line breaks into single spaces and trims the ends. */
function flatten(text) {
  return text.replace(/[ \t\r\n]+/g, " ").trim();
}

/** The characters that LaTeX commands such as `\textbackslash{}` stand for. */
const SYMBOL_COMMANDS = { textbackslash: "\\", textasciitilde: "~", textasciicircum: "^" };

/**
 * Converts LaTeX text into marked-up plain text: structure commands become lines starting with
 * `#H ` (heading), `#B ` (bullet) or `#E ` (entry, left and right parts split by a tab); layout
 * commands are dropped; escapes such as `\&` become their characters.
 */
function convert(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "%") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (character === "\\") {
      index = convertCommand(source, index, (text) => (output += text));
    } else if (character === "{" || character === "}" || character === "$") {
      index += 1;
    } else {
      output += character === "~" ? " " : character;
      index += 1;
    }
  }
  return output;
}

/** Handles one backslash command at `index`, sends its text to `emit`, returns the next index. */
function convertCommand(source, index, emit) {
  const next = source[index + 1] ?? "";
  if (next === "\\") {
    emit("\n");
    return index + 2;
  }
  if (!/[a-zA-Z]/.test(next)) {
    if ("&%$#_{}".includes(next)) emit(next);
    return index + 2;
  }
  let end = index + 1;
  while (end < source.length && /[a-zA-Z]/.test(source[end])) end += 1;
  const name = source.slice(index + 1, end);
  if (source[end] === "*") end += 1;
  const readGroups = (count) => {
    const found = [];
    for (let number = 0; number < count; number += 1) {
      const group = readGroup(source, end);
      found.push(flatten(convert(group.content)));
      end = group.end;
    }
    return found;
  };
  if (name === "section") emit(`\n#H ${readGroups(1)[0]}\n`);
  else if (name === "resumeItem") emit(`\n#B ${readGroups(1)[0]}\n`);
  else if (name === "resumeSubheading") {
    const [first, second, third, fourth] = readGroups(4);
    emit(`\n#E ${first}\t${second}\n#E ${third}\t${fourth}\n`);
  } else if (name === "resumeProjectHeading") {
    const [first, second] = readGroups(2);
    emit(`\n#E ${first}\t${second}\n`);
  } else if (name === "vspace" || name === "hspace") readGroups(1);
  else if (name === "href" || name === "textcolor") emit(readGroups(2)[1]);
  else if (name in SYMBOL_COMMANDS) {
    emit(SYMBOL_COMMANDS[name]);
    if (source.startsWith("{}", end)) end += 2;
  } else if (name === "begin" || name === "end") {
    end = readGroup(source, end).end;
    if (source[end] === "[") end = source.indexOf("]", end) + 1 || source.length;
    emit("\n");
  } else if (name === "item") emit("\n");
  return end;
}

/**
 * Reads the body of a resume (between `\begin{document}` and `\end{document}`) and returns its
 * lines. A source without those markers is read whole. Empty lines are dropped.
 * Example: a body with one section and one item gives two lines.
 */
export function texToLines(texSource) {
  const startMarker = "\\begin{document}";
  const start = texSource.indexOf(startMarker);
  const body = start === -1 ? texSource : texSource.slice(start + startMarker.length);
  const endIndex = body.indexOf("\\end{document}");
  const text = convert(endIndex === -1 ? body : body.slice(0, endIndex));
  const lines = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/[ \r]+/g, " ").trim();
    if (line.length === 0) continue;
    if (line.startsWith("#H ")) lines.push({ kind: "heading", text: line.slice(3).trim() });
    else if (line.startsWith("#B ")) lines.push({ kind: "bullet", text: line.slice(3).trim() });
    else if (line.startsWith("#E ")) {
      const [left, right] = line.slice(3).split("\t");
      lines.push({ kind: "entry", text: (left ?? "").trim(), aside: (right ?? "").trim() });
    } else lines.push({ kind: "text", text: line });
  }
  return lines;
}
