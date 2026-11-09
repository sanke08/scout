/**
 * The run log: what is written to `<data>/agent-runs/` and how old files are removed.
 *
 * Why it exists: the raw output of `claude` holds the owner's whole profile, mail previews and
 * form text. The log keeps only what is needed to understand a run afterwards: one short line per
 * event (the model's words, the tool name with short arguments, whether a tool answered or
 * failed). Tool answers are never written, and every line is cut to a fixed length.
 *
 * Example: `logLineFor(rawLine)` for a tool call gives `{"kind":"tool","summary":"read_posting(jobId=ab12)"}`;
 * for a tool answer it gives `{"kind":"result","summary":"ok"}`, without the answer.
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MAXIMUM_SUMMARY_CHARACTERS, oneLine, parseStreamLine } from "./stream-parser.js";

/** The longest log line written, in characters. */
export const MAXIMUM_LOG_LINE_CHARACTERS = 400;

/** How many run logs (and their config files) are kept. */
export const MAXIMUM_KEPT_RUNS = 30;

/** Run files are named `<time stamp>-<task>.jsonl` and `<time stamp>-<task>.mcp.json`. */
const RUN_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2}T[\d-]+-[a-z]+)\.(jsonl|mcp\.json)$/;

/** Shapes one event for the log. Tool answers are reduced to ok or error. */
function describeEvent(kind: string, summary: string): string {
  const text = kind === "result" ? (summary.startsWith("error:") ? "error" : "ok") : summary;
  return JSON.stringify({ kind, summary: oneLine(text, MAXIMUM_SUMMARY_CHARACTERS) });
}

/**
 * Turns one raw stream line into the lines to log (none for lines that carry no event).
 * Every returned line is at most `MAXIMUM_LOG_LINE_CHARACTERS` long.
 */
export function logLinesFor(rawLine: string): string[] {
  const parsed = parseStreamLine(rawLine);
  const lines = parsed.events.map((event) => describeEvent(event.kind, event.summary));
  if (parsed.final !== undefined) {
    lines.push(
      JSON.stringify({
        kind: "final",
        success: parsed.final.success,
        turns: parsed.final.turns,
        summary: oneLine(parsed.final.text, MAXIMUM_SUMMARY_CHARACTERS),
      }),
    );
  }
  return lines.map((line) =>
    line.length <= MAXIMUM_LOG_LINE_CHARACTERS
      ? line
      : JSON.stringify({ kind: "cut", summary: oneLine(line, 150) }),
  );
}

/**
 * Deletes the oldest run files so that at most `keep` runs remain. `last-result.json` and the
 * lock are never touched. Failure to delete is ignored: an old log left behind is harmless.
 */
export function pruneRunFiles(runsDirectory: string, keep: number = MAXIMUM_KEPT_RUNS): void {
  let names: string[];
  try {
    names = readdirSync(runsDirectory);
  } catch {
    return;
  }
  const runs = new Set<string>();
  for (const name of names) {
    const match = RUN_FILE_PATTERN.exec(name);
    if (match?.[1] !== undefined) runs.add(match[1]);
  }
  const oldest = [...runs].sort().slice(0, Math.max(0, runs.size - keep));
  for (const run of oldest) {
    for (const extension of ["jsonl", "mcp.json"]) {
      rmSync(join(runsDirectory, `${run}.${extension}`), { force: true });
    }
  }
}
