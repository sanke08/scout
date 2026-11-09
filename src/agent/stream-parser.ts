/**
 * Turns the lines `claude --output-format stream-json` prints into short log events.
 *
 * Why it exists: the live log shows what the model is doing without the owner reading raw JSON.
 * Each line becomes zero or more `AgentEvent`s with a one-line, shortened, secret-free summary.
 * A line that is not JSON, or a kind of line this file does not know, is ignored (never an error),
 * so a new line type in a future version of the tool cannot break a run.
 *
 * Example: the line `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__scout__get_profile","input":{}}]}}`
 * gives one `tool` event "get_profile" and counts one tool call.
 */
import type { AgentEvent } from "./types.js";

/** The prefix the model sees on every Scout tool; removed in summaries. */
const SCOUT_TOOL_PREFIX = "mcp__scout__";

/** The longest summary kept, in characters. */
export const MAXIMUM_SUMMARY_CHARACTERS = 300;

/** The longest single argument value shown inside a tool summary. */
const MAXIMUM_ARGUMENT_CHARACTERS = 60;

/** Argument names whose values are never shown. */
const SECRET_NAME_PATTERN =
  /password|passwd|secret|token|api.?key|credential|authorization|cookie/i;

/** What one stream line means to the runner. */
export interface ParsedLine {
  events: Omit<AgentEvent, "at">[];
  /** Tool calls seen on this line. */
  toolCalls: number;
  /** True when this line is one model message (a turn). */
  turn: boolean;
  /** Set on the closing `result` line. */
  final?: { success: boolean; text: string; turns: number | undefined };
}

/** Shortens text to one line of at most `limit` characters. */
export function oneLine(text: string, limit: number = MAXIMUM_SUMMARY_CHARACTERS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** Describes tool input as `name=value, name=value`, hiding secret-looking names and long values. */
export function summariseInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const parts: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (SECRET_NAME_PATTERN.test(name)) {
      parts.push(`${name}=[hidden]`);
      continue;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    parts.push(`${name}=${oneLine(text ?? "", MAXIMUM_ARGUMENT_CHARACTERS)}`);
  }
  return parts.join(", ");
}

/** Reads the text of a tool result, which is either a string or a list of blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" && block !== null && "text" in block ? String(block.text) : "",
    )
    .join(" ");
}

/** True for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses one stdout line. Never throws. */
export function parseStreamLine(line: string): ParsedLine {
  const empty: ParsedLine = { events: [], toolCalls: 0, turn: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return empty;
  }
  if (!isRecord(parsed)) return empty;

  if (parsed["type"] === "result") {
    const text = typeof parsed["result"] === "string" ? parsed["result"] : "";
    const turns = typeof parsed["num_turns"] === "number" ? parsed["num_turns"] : undefined;
    const success = parsed["subtype"] === "success" && parsed["is_error"] !== true;
    return {
      ...empty,
      final: {
        success,
        text: success ? text : text || String(parsed["subtype"] ?? "error"),
        turns,
      },
    };
  }

  const message = parsed["message"];
  if (!isRecord(message) || !Array.isArray(message["content"])) return empty;

  if (parsed["type"] === "assistant") {
    const result: ParsedLine = { events: [], toolCalls: 0, turn: true };
    for (const block of message["content"]) {
      if (!isRecord(block)) continue;
      if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim()) {
        result.events.push({ kind: "text", summary: oneLine(block["text"]) });
      } else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
        result.toolCalls += 1;
        const name = block["name"].startsWith(SCOUT_TOOL_PREFIX)
          ? block["name"].slice(SCOUT_TOOL_PREFIX.length)
          : block["name"];
        const arguments_ = summariseInput(block["input"]);
        result.events.push({
          kind: "tool",
          summary: oneLine(arguments_ ? `${name}(${arguments_})` : name),
        });
      }
    }
    return result;
  }

  if (parsed["type"] === "user") {
    const result: ParsedLine = { events: [], toolCalls: 0, turn: false };
    for (const block of message["content"]) {
      if (!isRecord(block) || block["type"] !== "tool_result") continue;
      const text = oneLine(resultText(block["content"]), 200);
      result.events.push({
        kind: "result",
        summary: block["is_error"] === true ? `error: ${text}` : text || "(empty)",
      });
    }
    return result;
  }
  return empty;
}
