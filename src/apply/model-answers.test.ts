/**
 * Tests of `applyModelAnswers`.
 *
 * What must stay true: a model answer never fills a field the owner's never-guess settings keep
 * for the owner (needs-you mappings: legal, salary, personal, demographic when asked each time),
 * whatever the answer says; a value the profile already supplies is never replaced; a free-text
 * answer must pass the caller's claim check; nothing on the never-used list is typed.
 */
import { describe, expect, it } from "vitest";
import type { FormField } from "./form-types.js";
import type { FieldMapping } from "./map-fields.js";
import { applyModelAnswers } from "./model-answers.js";

/** A text field with the given key. */
function field(key: string, overrides: Partial<FormField> = {}): FormField {
  return {
    key,
    label: `Question ${key}`,
    name: key,
    type: "text",
    required: true,
    options: [],
    selector: `[name="${key}"]`,
    ...overrides,
  };
}

/** A mapping with the given status and kind. */
function mapping(
  key: string,
  status: FieldMapping["status"],
  kind: FieldMapping["kind"],
  overrides: Partial<FormField> = {},
): FieldMapping {
  return { field: field(key, overrides), kind, status, reason: `Reason for ${key}.` };
}

describe("applyModelAnswers", () => {
  it("fills a field the profile could not fill", () => {
    const result = applyModelAnswers([mapping("source", "unknown", "factual")], {
      source: "A friend told me",
    });
    expect(result.used).toEqual({ source: "A friend told me" });
    expect(result.mappings[0]?.status).toBe("ready");
    expect(result.mappings[0]?.source).toBe("model-answer");
  });

  it("never fills a needs-you field, whatever the kind and whatever the answer", () => {
    const kinds = ["legal", "salary", "personal", "demographic"] as const;
    for (const kind of kinds) {
      const original = mapping(kind, "needs-you", kind);
      const result = applyModelAnswers([original], { [kind]: "Yes, I confirm" });
      expect(result.mappings[0]).toEqual(original);
      expect(result.used).toEqual({});
      expect(result.refused[0]?.reason).toMatch(/only the owner/);
    }
  });

  it("keeps the owner-only rule even when a mapping of those kinds is merely unknown", () => {
    const original = mapping("pay", "unknown", "salary");
    const result = applyModelAnswers([original], { pay: "90000 euro" });
    expect(result.mappings[0]?.status).toBe("unknown");
    expect(result.refused).toHaveLength(1);
  });

  it("leaves prefer-not-to-say to the mapping code: the model's answer is ignored", () => {
    const ready: FieldMapping = {
      field: field("gender", { type: "select", options: ["Male", "Prefer not to say"] }),
      kind: "demographic",
      status: "ready",
      value: "Prefer not to say",
      source: "demographic-setting",
      reason: 'Your setting is "prefer not to say" and the form offers that choice.',
    };
    const result = applyModelAnswers([ready], { gender: "Male" });
    expect(result.mappings[0]?.value).toBe("Prefer not to say");
    expect(result.ignored.map((item) => item.fieldKey)).toEqual(["gender"]);
    expect(result.used).toEqual({});
  });

  it("refuses a choice that is not on the page's list", () => {
    const result = applyModelAnswers(
      [mapping("size", "unknown", "factual", { type: "select", options: ["Small", "Large"] })],
      { size: "Maybe" },
    );
    expect(result.refused[0]?.reason).toMatch(/not one of this field's choices/);
  });

  it("refuses a free-text answer the claim check rejects, and uses the reason it gives", () => {
    const result = applyModelAnswers(
      [mapping("about", "draft-needed", "motivational")],
      { about: "I ran Kafka for nine years" },
      {
        checkFreeText: (answer) =>
          answer.includes("Kafka") ? "Kafka is not in the profile." : undefined,
      },
    );
    expect(result.used).toEqual({});
    expect(result.refused[0]?.reason).toBe("Kafka is not in the profile.");
  });

  it("does not run the free-text claim check on a choice", () => {
    let calls = 0;
    const result = applyModelAnswers(
      [mapping("size", "unknown", "factual", { type: "select", options: ["Small", "Large"] })],
      { size: "Large" },
      {
        checkFreeText: () => {
          calls += 1;
          return "never";
        },
      },
    );
    expect(calls).toBe(0);
    expect(result.used).toEqual({ size: "Large" });
  });

  it("refuses an answer that uses a never-used term, in any case and inside a longer word", () => {
    const rules = { neverUsed: ["Side Project"] };
    const refused = applyModelAnswers(
      [mapping("about", "draft-needed", "motivational")],
      { about: "Through my SIDE PROJECT, mostly" },
      rules,
    );
    expect(refused.used).toEqual({});
    expect(refused.refused[0]?.reason).toMatch(/never to be used/);
    const allowed = applyModelAnswers(
      [mapping("about", "draft-needed", "motivational")],
      { about: "Through my side projects" },
      rules,
    );
    // A term of four or more letters is found inside longer words too ("projects" contains it).
    expect(allowed.used).toEqual({});
    const clean = applyModelAnswers(
      [mapping("about", "draft-needed", "motivational")],
      { about: "Through my hobbies" },
      rules,
    );
    expect(clean.used).toEqual({ about: "Through my hobbies" });
  });
});

describe("neverUsed matching", () => {
  /** True when the answer was refused because of the never-used list. */
  function refusedFor(term: string, answer: string): boolean {
    const result = applyModelAnswers(
      [mapping("note", "unknown", "factual")],
      { note: answer },
      { neverUsed: [term] },
    );
    return result.refused.length === 1 && /never to be used/.test(result.refused[0]!.reason);
  }

  it.each([
    ["synergy", "We create great Synergy!"],
    ["Synergy", "synergy"],
    ["full-stack", "I am a full stack developer"],
    ["full stack", "A Full-Stack role"],
    ["fullstack", "full-stack work"],
    ["leverage", "I leveraged caching"],
    ["rockstar", "a ROCK-STAR engineer"],
    ["results-driven", "Results driven, and proud"],
    ["Node.js", "I use nodejs daily"],
  ])("refuses %j in %j (case, punctuation and hyphens do not matter)", (term, answer) => {
    expect(refusedFor(term, answer)).toBe(true);
  });

  it("matches a short term only as a whole word, so it does not block every word containing it", () => {
    expect(refusedFor("Go", "I write Go and Python")).toBe(true);
    expect(refusedFor("Go", "I am going to relocate, good morning")).toBe(false);
    expect(refusedFor("AI", "I paid attention")).toBe(false);
  });

  it("lets an answer through that does not contain the term", () => {
    expect(refusedFor("synergy", "A friend told me about the role")).toBe(false);
  });
});
