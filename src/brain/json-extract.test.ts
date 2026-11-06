/** Tests for `extractFirstJson`: plain, fenced, array, brace-in-string, prose braces, nothing found. */
import { describe, expect, it } from "vitest";
import { extractFirstJson } from "./json-extract.js";

describe("extractFirstJson", () => {
  it("reads plain JSON", () => {
    expect(extractFirstJson('{"score": 7}')).toEqual({ found: true, value: { score: 7 } });
  });

  it("reads JSON inside a code fence with prose around it", () => {
    const text = 'Sure! Here you go:\n```json\n{"score": 7, "tags": ["a"]}\n```\nHope that helps.';
    expect(extractFirstJson(text)).toEqual({ found: true, value: { score: 7, tags: ["a"] } });
  });

  it("reads an array", () => {
    expect(extractFirstJson("Result: [1, 2, 3]")).toEqual({ found: true, value: [1, 2, 3] });
  });

  it("is not fooled by braces inside strings", () => {
    const text = '{"note": "a } and a { inside", "n": 1} trailing';
    expect(extractFirstJson(text)).toEqual({
      found: true,
      value: { note: "a } and a { inside", n: 1 },
    });
  });

  it("skips braces that are only prose and keeps looking", () => {
    expect(extractFirstJson('Use {x} like so: {"ok": true}')).toEqual({
      found: true,
      value: { ok: true },
    });
  });

  it("reports nothing found for text without JSON or with unbalanced JSON", () => {
    expect(extractFirstJson("no data here")).toEqual({ found: false });
    expect(extractFirstJson('{"a": 1')).toEqual({ found: false });
  });
});
