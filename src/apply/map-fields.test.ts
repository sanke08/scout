import { describe, expect, it } from "vitest";
import type { AnswerEntry } from "../shared/index.js";
import { findBankAnswer, mapFields, matchOption } from "./map-fields.js";
import { snapshotForm } from "./snapshot.js";
import {
  formHtml,
  profileForGreenhouse,
  sampleProfile,
  settingsWith,
  type FixtureName,
} from "./test-helpers.js";

/** Maps a saved form with the sample profile and returns the mapping by field label. */
function mapByLabel(
  name: FixtureName,
  options: { bank?: AnswerEntry[]; demographic?: "prefer-not-to-say" | "ask-each-time" } = {},
) {
  const profile = sampleProfile();
  const snapshot = snapshotForm(formHtml(name));
  const settings = settingsWith({ demographicAnswers: options.demographic ?? "prefer-not-to-say" });
  const mappings = mapFields(snapshot, profile, options.bank ?? profile.answerBank, settings);
  return new Map(mappings.map((mapping) => [mapping.field.label, mapping]));
}

describe("mapFields identity and files", () => {
  it("maps contact details from the profile identity", () => {
    const map = mapByLabel("greenhouse-style");
    expect(map.get("First Name")?.value).toBe("Alex");
    expect(map.get("Last Name")?.value).toBe("Rivera");
    expect(map.get("Email")?.value).toBe("alex.rivera@example.com");
    expect(map.get("Phone")?.value).toBe("+49 30 0000 0000");
    expect(map.get("LinkedIn Profile")?.value).toBe("https://www.linkedin.com/in/example-alex");
    expect(map.get("Email")?.source).toBe("identity");
  });

  it("maps the resume field to the resume source and leaves a cover letter to a draft", () => {
    const map = mapByLabel("greenhouse-style");
    expect(map.get("Resume/CV")?.source).toBe("resume");
    expect(map.get("Cover Letter")?.status).toBe("draft-needed");
  });

  it("maps a single full-name field and a location field on the Lever-style form", () => {
    const map = mapByLabel("lever-style");
    expect(map.get("Full name")?.value).toBe("Alex Rivera");
    expect(map.get("Current location")?.value).toBe("Berlin, Germany");
  });

  it("does not take a question that merely mentions a city or a name as identity", () => {
    const snapshot = snapshotForm(
      '<form><label for="a">Are you in the same city as the office?</label><input id="a" name="a"><label for="b">Name of your manager</label><input id="b" name="b"></form>',
    );
    const profile = sampleProfile();
    const mappings = mapFields(snapshot, profile, [], settingsWith());
    for (const mapping of mappings) expect(mapping.source).not.toBe("identity");
  });
});

describe("mapFields questions", () => {
  it("uses an approved bank answer and picks the matching option", () => {
    const map = mapByLabel("greenhouse-style");
    const euWork = map.get("Are you authorised to work in the EU?");
    expect(euWork?.status).toBe("ready");
    expect(euWork?.value).toBe("Yes");
    expect(euWork?.source).toBe("answer-bank");
  });

  it("never guesses a legal question that is not in the bank", () => {
    const map = mapByLabel("greenhouse-style", { bank: [] });
    expect(map.get("Are you authorised to work in the EU?")?.status).toBe("needs-you");
    expect(map.get("Are you authorised to work in the EU?")?.kind).toBe("legal");
  });

  it("never guesses personal, salary and consent questions that are not in the bank", () => {
    expect(mapByLabel("lever-style").get("Are you open to relocating to Berlin?")?.status).toBe(
      "needs-you",
    );
    const ashby = mapByLabel("ashby-style");
    expect(ashby.get("What are your salary expectations?")?.status).toBe("needs-you");
    expect(ashby.get("What are your salary expectations?")?.kind).toBe("salary");
    const consent = ashby.get("I agree to the processing of my data under the privacy policy");
    expect(consent?.status).toBe("needs-you");
    expect(consent?.kind).toBe("legal");
  });

  it("marks motivational questions as draft-needed, never ready", () => {
    const ashby = mapByLabel("ashby-style");
    expect(ashby.get("Describe a time you disagreed with a senior engineer")?.status).toBe(
      "draft-needed",
    );
  });

  it("marks a factual question with no value as unknown", () => {
    expect(mapByLabel("greenhouse-style").get("How did you hear about this job?")?.status).toBe(
      "unknown",
    );
  });

  it("does not use a bank entry that has no approval date", () => {
    const unapproved: AnswerEntry = {
      question: "What is your notice period?",
      kind: "factual",
      answer: "30 days.",
      approvedOn: "",
    };
    expect(
      mapByLabel("lever-style", { bank: [unapproved] }).get("What is your notice period?")?.status,
    ).not.toBe("ready");
  });

  it("leaves a bank answer that is not one of the options to the user", () => {
    const odd: AnswerEntry = {
      question: "Are you authorised to work in the EU?",
      kind: "legal",
      answer: "Maybe",
      approvedOn: "2026-01-15",
    };
    expect(
      mapByLabel("greenhouse-style", { bank: [odd] }).get("Are you authorised to work in the EU?")
        ?.status,
    ).toBe("needs-you");
  });

  it("answers a yes tick box from the bank", () => {
    const consent: AnswerEntry = {
      question: "I agree to the processing of my data under the privacy policy",
      kind: "legal",
      answer: "Yes",
      approvedOn: "2026-01-15",
    };
    const mapping = mapByLabel("ashby-style", { bank: [consent] }).get(consent.question);
    expect(mapping?.status).toBe("ready");
    expect(mapping?.value).toBe("true");
  });
});

describe("mapFields demographic questions", () => {
  it('"prefer-not-to-say" picks the matching option text when the form has one', () => {
    const map = mapByLabel("greenhouse-style", { demographic: "prefer-not-to-say" });
    expect(map.get("Gender")?.status).toBe("ready");
    expect(map.get("Gender")?.value).toBe("I do not wish to answer");
    expect(map.get("Veteran status")).toBeUndefined();
    expect(mapByLabel("lever-style").get("Veteran status")?.value).toBe("Decline to self-identify");
  });

  it('"prefer-not-to-say" with no matching option, or a text box, is needs-you', () => {
    const ashby = mapByLabel("ashby-style", { demographic: "prefer-not-to-say" });
    expect(ashby.get("What pronouns do you use?")?.status).toBe("needs-you");
  });

  it('"ask-each-time" makes every demographic question needs-you', () => {
    const map = mapByLabel("greenhouse-style", { demographic: "ask-each-time" });
    expect(map.get("Gender")?.status).toBe("needs-you");
    expect(
      mapByLabel("lever-style", { demographic: "ask-each-time" }).get("Veteran status")?.status,
    ).toBe("needs-you");
  });
});

describe("answer bank helpers", () => {
  it("findBankAnswer matches the same words and a contained longer question, not a short word", () => {
    const profile = sampleProfile();
    expect(findBankAnswer("What is your notice period?", profile.answerBank)?.answer).toBe(
      "30 days.",
    );
    expect(findBankAnswer("period?", profile.answerBank)).toBeUndefined();
    expect(findBankAnswer("Why do you like cats?", profile.answerBank)).toBeUndefined();
    const degree: AnswerEntry[] = [
      {
        question: "Do you have a degree?",
        kind: "factual",
        answer: "Yes.",
        approvedOn: "2026-01-15",
      },
    ];
    expect(findBankAnswer("Do you have a degree in computer science?", degree)).toBeUndefined();
    expect(findBankAnswer("Do you have a degree? *", degree)?.answer).toBe("Yes.");
  });

  it("matchOption finds equal and starts-with options and nothing else", () => {
    expect(matchOption(["Yes", "No"], "Yes.")).toBe("Yes");
    expect(matchOption(["Yes, I am authorised", "No"], "yes")).toBe("Yes, I am authorised");
    expect(matchOption(["Yes", "No"], "Maybe")).toBeUndefined();
  });
});

describe("mapFields output", () => {
  it("returns one mapping per field, in page order", () => {
    const profile = profileForGreenhouse();
    const snapshot = snapshotForm(formHtml("greenhouse-style"));
    const mappings = mapFields(snapshot, profile, profile.answerBank, settingsWith());
    expect(mappings.map((mapping) => mapping.field.key)).toEqual(
      snapshot.fields.map((field) => field.key),
    );
  });
});
