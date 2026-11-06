/** Tests for `proposeWording`: blocked claim, retry, give-up, brain failure. */
import { describe, expect, it } from "vitest";
import { createFakeBrain } from "./fake-brain.js";
import { proposeWording } from "./wording.js";

/** A fictional profile point used by every wording test. */
const point = { text: "Mentored two juniors", allowed: ["mentoring", "Kafka"] };

describe("proposeWording", () => {
  it("blocks 'led a team of eight', retries with a correction, and accepts the corrected wording", async () => {
    const brain = createFakeBrain([
      { kind: "value", value: { text: "Led a team of eight" } },
      { kind: "value", value: { text: "Mentored two juniors on Kafka" } },
    ]);
    const result = await proposeWording(brain, point);
    expect(result).toEqual({ ok: true, text: "Mentored two juniors on Kafka" });
    expect(brain.receivedPrompts[0]).not.toContain("rejected because");
    expect(brain.receivedPrompts[1]).toContain("team of eight");
    expect(brain.receivedPrompts[1]).toContain("rejected because");
  });

  it("gives up after two retries so the caller can go to the user", async () => {
    const bad = { kind: "value" as const, value: { text: "Led a team of eight" } };
    const brain = createFakeBrain([
      bad,
      bad,
      bad,
      { kind: "value", value: { text: "Mentored two juniors" } },
    ]);
    const result = await proposeWording(brain, point);
    expect(result).toMatchObject({ ok: false, reason: "unsupported-claims" });
    expect(brain.receivedPrompts).toHaveLength(3);
    expect(brain.remainingReplies()).toBe(1);
  });

  it("returns a brain failure at once without retrying", async () => {
    const brain = createFakeBrain([{ kind: "limit-reached", resetAt: "2026-11-07T12:00:00.000Z" }]);
    expect(await proposeWording(brain, point)).toEqual({
      ok: false,
      reason: "limit-reached",
      message: expect.any(String),
      resetAt: "2026-11-07T12:00:00.000Z",
    });
  });

  it("allows extra known facts to back the wording", async () => {
    const brain = createFakeBrain([
      { kind: "value", value: { text: "Mentored two juniors in 2025" } },
    ]);
    const result = await proposeWording(brain, point, {
      knownFacts: ["Started mentoring in 2025"],
    });
    expect(result.ok).toBe(true);
  });

  it("lists the allowed terms in the instructions and keeps the original point there", async () => {
    const brain = createFakeBrain([{ kind: "value", value: { text: "Mentored two juniors" } }]);
    await proposeWording(brain, point);
    expect(brain.receivedPrompts[0]).toContain("Use ONLY these terms: mentoring, Kafka.");
    expect(brain.receivedPrompts[0]).toContain("Original point: Mentored two juniors");
  });
});
