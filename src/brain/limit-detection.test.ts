/** Tests for `detectLimit`: ordinary output, each reset-time form, both output streams. */
import { describe, expect, it } from "vitest";
import { detectLimit } from "./limit-detection.js";

/** Fixed clock so relative reset times are predictable. */
const now = new Date("2026-11-07T10:00:00.000Z");

describe("detectLimit", () => {
  it("does not flag ordinary output", () => {
    expect(detectLimit('{"score": 7}', "")).toEqual({ limited: false });
  });

  it("flags a usage limit with no reset time", () => {
    expect(detectLimit("", "Error: usage limit reached", now)).toEqual({ limited: true });
  });

  it("reads a relative wait such as 'resets in 2 hours'", () => {
    const result = detectLimit("Rate limit hit. Limit resets in 2 hours.", "", now);
    expect(result).toEqual({ limited: true, resetAt: "2026-11-07T12:00:00.000Z" });
  });

  it("adds up a wait given in several units", () => {
    const result = detectLimit("Rate limit. Try again in 1 hour 30 minutes.", "", now);
    expect(result.resetAt).toBe("2026-11-07T11:30:00.000Z");
  });

  it("reads a full timestamp", () => {
    const result = detectLimit(
      "Usage limit reached. Your limit will reset at 2026-11-07T15:00:00Z",
      "",
      now,
    );
    expect(result.resetAt).toBe("2026-11-07T15:00:00.000Z");
  });

  it("reads a clock time as the next time the local clock shows it", () => {
    const result = detectLimit("Usage limit reached. Your limit will reset at 3pm.", "", now);
    expect(result.limited).toBe(true);
    const resetAt = new Date(result.resetAt!);
    expect(resetAt.getHours()).toBe(15);
    expect(resetAt.getMinutes()).toBe(0);
    expect(resetAt.getTime()).toBeGreaterThan(now.getTime());
    expect(resetAt.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it("reads the epoch-seconds form", () => {
    const result = detectLimit("Claude AI usage limit reached|1794000000", "", now);
    expect(result.resetAt).toBe(new Date(1794000000 * 1000).toISOString());
  });

  it("looks at both output streams", () => {
    expect(detectLimit("", "429 Too Many Requests", now).limited).toBe(true);
  });
});
