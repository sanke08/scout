import { describe, expect, it } from "vitest";
import { classifyQuestion } from "./classify-question.js";

describe("classifyQuestion", () => {
  it.each([
    ["Gender", "demographic"],
    ["Veteran status", "demographic"],
    ["What pronouns do you use?", "demographic"],
    ["Are you authorised to work in the EU?", "legal"],
    ["Will you now or in the future require visa sponsorship?", "legal"],
    ["I agree to the processing of my data under the privacy policy", "legal"],
    ["What are your salary expectations?", "salary"],
    ["Why do you want to work at ExampleCorp?", "motivational"],
    ["Describe a time you disagreed with a senior engineer", "motivational"],
    ["Are you open to relocating to Berlin?", "personal"],
    ["What is your notice period?", "personal"],
    ["How did you hear about this job?", "factual"],
    ["Years of experience with Node.js", "factual"],
  ] as const)("sorts %j as %s", (question, kind) => {
    expect(classifyQuestion(question)).toBe(kind);
  });

  it("gives a question that fits two kinds the more careful one", () => {
    expect(classifyQuestion("Why do you need visa sponsorship?")).toBe("legal");
  });
});
