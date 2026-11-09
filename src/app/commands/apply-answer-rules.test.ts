/**
 * Tests of `answerRulesFor`: a free-text answer is backed by the profile's facts or refused, and the
 * owner's never-used list travels with the rules.
 */
import { describe, expect, it } from "vitest";
import { makePosting, sampleProfile } from "../../apply/test-helpers.js";
import type { JobRecord } from "../../shared/index.js";
import { answerRulesFor } from "./apply-answer-rules.js";

/** A job record for the fictional posting. */
function job(): JobRecord {
  return { ...makePosting(), status: "shortlisted", updatedAt: "2026-11-09T10:00:00.000Z" };
}

describe("answerRulesFor", () => {
  const rules = answerRulesFor(sampleProfile(), job());

  it("allows an answer made of facts the profile states, and the posting's own names", () => {
    expect(rules.checkFreeText?.("30 days")).toBeUndefined();
    expect(rules.checkFreeText?.("I would enjoy working at ExampleCorp")).toBeUndefined();
  });

  it("refuses an answer that claims an employer, a skill or a figure the profile lacks", () => {
    for (const answer of [
      "I led the platform team at Initech",
      "I have 12 years of Kafka experience",
      "I managed a team of 40 engineers in 2019",
    ]) {
      expect(rules.checkFreeText?.(answer), answer).toMatch(/does not back/);
    }
  });

  it("carries the never-used list", () => {
    expect(rules.neverUsed).toEqual(sampleProfile().neverUsed);
  });
});
