/** Tests for the stream-json parser: short, secret-free summaries and no crash on odd input. */
import { describe, expect, it } from "vitest";
import { assistantText, assistantToolUse, successResult, toolResultLine } from "./fake-claude.js";
import { MAXIMUM_SUMMARY_CHARACTERS, parseStreamLine } from "./stream-parser.js";

describe("parseStreamLine", () => {
  it("shows a Scout tool call without the server prefix and counts it", () => {
    const parsed = parseStreamLine(assistantToolUse("get_profile"));
    expect(parsed).toMatchObject({ toolCalls: 1, turn: true });
    expect(parsed.events).toEqual([{ kind: "tool", summary: "get_profile" }]);
  });

  it("never shows the value of a secret-looking argument and shortens long ones", () => {
    const line = assistantToolUse("login", {
      password: "hunter2-very-secret",
      apiKey: "sk-123",
      note: "x".repeat(500),
    });
    const summary = parseStreamLine(line).events[0]?.summary ?? "";
    expect(summary).not.toContain("hunter2");
    expect(summary).not.toContain("sk-123");
    expect(summary.length).toBeLessThanOrEqual(MAXIMUM_SUMMARY_CHARACTERS);
  });

  it("keeps every summary on one short line", () => {
    const long = `first line\nsecond line ${"word ".repeat(300)}`;
    for (const line of [assistantText(long), toolResultLine(long)]) {
      for (const event of parseStreamLine(line).events) {
        expect(event.summary).not.toContain("\n");
        expect(event.summary.length).toBeLessThanOrEqual(MAXIMUM_SUMMARY_CHARACTERS);
      }
    }
  });

  it("marks a failed tool result as an error", () => {
    expect(parseStreamLine(toolResultLine("Scout is paused", true)).events[0]?.summary).toMatch(
      /^error:/,
    );
  });

  it("reads the closing result, success or not", () => {
    expect(parseStreamLine(successResult("All done.", 5)).final).toEqual({
      success: true,
      text: "All done.",
      turns: 5,
    });
    const failed = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "error_max_turns", num_turns: 4 }),
    );
    expect(failed.final?.success).toBe(false);
  });

  it("ignores lines that are not JSON or not understood", () => {
    for (const line of ["", "not json", "[]", '{"type":"system","subtype":"init"}', "null"]) {
      expect(parseStreamLine(line)).toEqual({ events: [], toolCalls: 0, turn: false });
    }
  });
});
