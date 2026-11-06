import { describe, expect, it } from "vitest";
import { createFakeBrain } from "../brain/index.js";
import { loadFixtureMessage } from "../../fixtures/mail/builders.js";
import { AMBIGUOUS_BELOW_CONFIDENCE, classifyMessage } from "./classify-message.js";
import { classifyWithBrain } from "./classify-with-brain.js";
import type { ParsedMessage } from "./message-types.js";

/** Builds a message with only the parts a test cares about. */
function messageWith(subject: string, text: string): ParsedMessage {
  return { id: "m", fromName: "", fromAddress: "x@example.com", subject, text, truncated: false };
}

describe("classifyMessage: one fixture per kind", () => {
  const cases = [
    ["received", "application-received"],
    ["recruiter", "recruiter-message"],
    ["interview-invite", "interview-invite"],
    ["assessment", "assessment"],
    ["rejection", "rejection"],
    ["html-only-rejection", "rejection"],
    ["offer", "offer"],
  ] as const;

  for (const [fixture, expectedKind] of cases) {
    it(`labels ${fixture} as ${expectedKind} with reasons`, async () => {
      const result = classifyMessage(await loadFixtureMessage(fixture));
      expect(result.kind).toBe(expectedKind);
      expect(result.confidence).toBeGreaterThanOrEqual(AMBIGUOUS_BELOW_CONFIDENCE);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  }

  it("calls a message with only weak hints ambiguous", async () => {
    const result = classifyMessage(await loadFixtureMessage("ambiguous"));
    expect(result.kind).toBe("ambiguous");
    expect(result.confidence).toBeLessThan(AMBIGUOUS_BELOW_CONFIDENCE);
  });

  it("labels an unrelated message other", () => {
    const result = classifyMessage(
      messageWith("Your invoice", "Your monthly receipt is attached."),
    );
    expect(result.kind).toBe("other");
  });
});

describe("classifyMessage: rule properties", () => {
  it("a rejection that also thanks the person for applying is a rejection, not a receipt", () => {
    const result = classifyMessage(
      messageWith(
        "Update",
        "Thank you for applying. We regret to inform you that we are not selecting you.",
      ),
    );
    expect(result.kind).toBe("rejection");
  });

  it("'unable to offer' is never an offer", () => {
    const result = classifyMessage(
      messageWith("Update", "We are unable to offer you a place and the position has been filled."),
    );
    expect(result.kind).toBe("rejection");
  });

  it("two decisive kinds with similar strength are ambiguous, not a guess", () => {
    const result = classifyMessage(
      messageWith(
        "Next steps",
        "We would like to schedule an interview. Please also complete the assessment first.",
      ),
    );
    expect(result.kind).toBe("ambiguous");
    expect(result.reasons.join(" ")).toMatch(/both/);
  });

  it("an interview invitation wins over a recruiter greeting", () => {
    const result = classifyMessage(
      messageWith("Hello", "I came across your profile. Can we schedule an interview this week?"),
    );
    expect(result.kind).toBe("interview-invite");
  });

  it("the word offer alone is not an offer", () => {
    const result = classifyMessage(messageWith("Sale", "Our best offer on shoes."));
    expect(result.kind).not.toBe("offer");
  });

  it("confidence is always between 0 and 1", async () => {
    for (const fixture of ["received", "offer", "rejection", "ambiguous", "injection"]) {
      const { confidence } = classifyMessage(await loadFixtureMessage(fixture));
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("classifyMessage: hostile text", () => {
  it("an email telling Scout to mark every job as offer is other, with a reason", async () => {
    const result = classifyMessage(await loadFixtureMessage("injection"));
    expect(result.kind).toBe("other");
    expect(result.reasons.join(" ")).toMatch(/instructions/);
  });

  it("is not sent to the model, so the model cannot be talked into a label", async () => {
    const brain = createFakeBrain([
      { kind: "value", value: { kind: "offer", confidence: 1, reason: "x" } },
    ]);
    const result = await classifyWithBrain(brain, await loadFixtureMessage("injection"));
    expect(result.kind).toBe("other");
    expect(brain.receivedPrompts).toHaveLength(0);
  });
});

describe("classifyWithBrain", () => {
  it("does not call the model when the rules are sure", async () => {
    const brain = createFakeBrain([]);
    const result = await classifyWithBrain(brain, await loadFixtureMessage("rejection"));
    expect(result.kind).toBe("rejection");
    expect(brain.receivedPrompts).toHaveLength(0);
  });

  it("asks the model for an ambiguous message and uses a valid answer", async () => {
    const brain = createFakeBrain([
      {
        kind: "value",
        value: { kind: "other", confidence: 0.85, reason: "no news, just a status note" },
      },
    ]);
    const result = await classifyWithBrain(brain, await loadFixtureMessage("ambiguous"));
    expect(result.kind).toBe("other");
    expect(result.reasons[0]).toMatch(/^model:/);
  });

  it("puts the message text in the untrusted part, never in the instructions", async () => {
    const brain = createFakeBrain([
      { kind: "value", value: { kind: "other", confidence: 0.9, reason: "fine" } },
    ]);
    const message = await loadFixtureMessage("ambiguous");
    await classifyWithBrain(brain, message);
    const prompt = brain.receivedPrompts[0] ?? "";
    const [instructionPart] = prompt.split(message.subject);
    expect(prompt).toContain(message.subject);
    expect(instructionPart).not.toContain("still deciding how the role will look");
  });

  it("returns the rules result when the model answers badly", async () => {
    const brain = createFakeBrain([
      { kind: "text", text: "not json" },
      { kind: "text", text: "still not json" },
    ]);
    const message = await loadFixtureMessage("ambiguous");
    const result = await classifyWithBrain(brain, message);
    expect(result).toEqual(classifyMessage(message));
  });

  it("returns the rules result when the model has no answer to give", async () => {
    const brain = createFakeBrain([{ kind: "limit-reached" }]);
    const message = await loadFixtureMessage("ambiguous");
    expect((await classifyWithBrain(brain, message)).kind).toBe("ambiguous");
  });

  it("ignores a model answer that is no surer than the rules", async () => {
    const brain = createFakeBrain([
      { kind: "value", value: { kind: "offer", confidence: 0.3, reason: "maybe" } },
    ]);
    const result = await classifyWithBrain(brain, await loadFixtureMessage("ambiguous"));
    expect(result.kind).toBe("ambiguous");
  });
});
