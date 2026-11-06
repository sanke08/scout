/**
 * Helpers for writing and reading Markdown table rows.
 *
 * Why it exists: the board table and the leads files are both Markdown tables whose cells come
 * from posting text, so a `|` or a line break inside a cell must not break the table.
 *
 * Example: `tableCell("A | B\nC")` is `A \| B C`; `tableRow(["1", "Acme"])` is `| 1 | Acme |`.
 * Failure: these functions do not throw.
 */

/** Makes text safe inside one table cell: pipes are escaped, line breaks become spaces. */
export function tableCell(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** Joins already-escaped cells into one table row line. */
export function tableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** The header row plus the divider row of a table. */
export function tableHeader(columns: string[]): string[] {
  return [tableRow(columns), tableRow(columns.map(() => "---"))];
}
