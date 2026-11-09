import { describe, expect, it } from "vitest";
import { classifyField, classifyQuestion } from "./classify-question.js";

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

/** Labels the model must NEVER answer, with the kind Scout gives them. */
const NEVER_GUESS: readonly (readonly [string, "demographic" | "personal" | "salary"])[] = [
  ["Age", "demographic"],
  ["Your age *", "demographic"],
  ["Date of birth", "personal"],
  ["DOB", "personal"],
  ["D.O.B.", "personal"],
  ["Birth date (dd/mm/yyyy)", "personal"],
  ["Caste", "demographic"],
  ["Category", "demographic"],
  ["Category *", "demographic"],
  ["Social category (General / OBC / SC / ST)", "demographic"],
  ["Religion", "demographic"],
  ["Nationality", "personal"],
  ["Marital status", "demographic"],
  ["Gender", "demographic"],
  ["Remuneration", "salary"],
  ["Current package", "salary"],
  ["Expected package", "salary"],
  ["Present CTC (in LPA)", "salary"],
  ["CTC", "salary"],
  ["Expected LPA", "salary"],
  ["Current salary", "salary"],
  ["Expected salary", "salary"],
  ["Last drawn salary", "salary"],
  ["Notice period", "personal"],
  ["Notice period (days)", "personal"],
  ["Are you serving notice?", "personal"],
  ["Last working day", "personal"],
  ["How soon can you join?", "personal"],
  ["Aadhaar number", "personal"],
  ["Aadhar No.", "personal"],
  ["PAN card number", "personal"],
  ["PAN", "personal"],
  ["SSN", "personal"],
  ["Social Security Number", "personal"],
  ["Passport number", "personal"],
  // Easy-to-add languages
  ["Geburtsdatum", "personal"],
  ["Alter", "demographic"],
  ["Geschlecht", "demographic"],
  ["Familienstand", "demographic"],
  ["Gehaltsvorstellung", "salary"],
  ["Kündigungsfrist", "personal"],
  ["Staatsangehörigkeit", "personal"],
  ["Date de naissance", "personal"],
  ["Âge", "demographic"],
  ["Prétentions salariales", "salary"],
  ["Préavis", "personal"],
  ["Passeport", "personal"],
  ["जन्म तिथि", "personal"],
  ["जन्मतिथि", "personal"],
  ["उम्र", "demographic"],
  ["लिंग", "demographic"],
  ["धर्म", "demographic"],
  ["वेतन", "salary"],
  ["नोटिस अवधि", "personal"],
  ["आधार संख्या", "personal"],
];

describe("classifyQuestion never-guess labels", () => {
  it.each(NEVER_GUESS)("keeps %j for the owner as %s", (label, kind) => {
    expect(classifyQuestion(label)).toBe(kind);
  });

  it("does not turn ordinary technical questions into never-guess ones", () => {
    for (const label of [
      "Years of experience with Node.js",
      "Which package manager do you use?",
      "Do you have experience with image processing?",
      "Your management experience",
      "Programming languages",
    ]) {
      expect(classifyQuestion(label), label).toBe("factual");
    }
  });
});

describe("classifyField (choices go through the same rules)", () => {
  const choice = (label: string, name: string, options: string[]) => ({ label, name, options });

  it("classifies a select, radio or tick-box group by its label, its code name or its choices", () => {
    expect(classifyField(choice("Please choose", "candidate[gender]", ["A", "B"]))).toBe(
      "demographic",
    );
    expect(classifyField(choice("Select one", "dateOfBirth", []))).toBe("personal");
    expect(classifyField(choice("Select one", "q_17", ["Male", "Female", "Other"]))).toBe(
      "demographic",
    );
    expect(classifyField(choice("Select one", "q_18", ["Immediate", "30 days notice"]))).toBe(
      "personal",
    );
    expect(classifyField(choice("Select one", "q_19", ["General", "OBC", "SC/ST"]))).toBe(
      "demographic",
    );
    expect(classifyField(choice("Current CTC band", "band", ["<10 LPA", "10-20 LPA"]))).toBe(
      "salary",
    );
  });

  it("leaves a plain choice factual", () => {
    expect(
      classifyField(choice("How did you hear about us?", "source", ["LinkedIn", "Referral"])),
    ).toBe("factual");
  });
});
