import { describe, expect, it } from "vitest";
import { mapFields } from "./map-fields.js";
import { planApplication } from "./plan.js";
import { planFor, profileForGreenhouse, sampleProfile, settingsWith } from "./test-helpers.js";

describe("planApplication", () => {
  it("has no blockers when every required field is known (Greenhouse-style with a full bank)", () => {
    const plan = planFor("greenhouse-style");
    expect(plan.blockers).toEqual([]);
    expect(plan.actions.length).toBeGreaterThan(5);
  });

  it("stops on an unknown required field: the Lever-style form has an unanswered relocation question", () => {
    const plan = planFor("lever-style", sampleProfile());
    const labels = plan.blockers.map((blocker) => blocker.label);
    expect(labels).toContain("Are you open to relocating to Berlin?");
    const relocation = plan.blockers.find((blocker) => blocker.label.includes("relocating"));
    expect(relocation?.status).toBe("needs-you");
  });

  it("reports both Scenario J questions: a motivational draft and a personal needs-you", () => {
    const plan = planFor("ashby-style", sampleProfile());
    const byLabel = new Map(plan.blockers.map((blocker) => [blocker.label, blocker.status]));
    expect(byLabel.get("Describe a time you disagreed with a senior engineer")).toBe(
      "draft-needed",
    );
    expect(byLabel.get("What are your salary expectations?")).toBe("needs-you");
  });

  it("never plans an action for a field that is not ready", () => {
    const plan = planFor("ashby-style", sampleProfile());
    const blocked = new Set(plan.blockers.map((blocker) => blocker.fieldKey));
    for (const action of plan.actions) expect(blocked.has(action.fieldKey)).toBe(false);
  });

  it("leaves optional unknown fields blank instead of stopping", () => {
    const plan = planFor("greenhouse-style");
    expect(plan.leftBlank.map((entry) => entry.label)).toContain(
      "How did you hear about this job?",
    );
    expect(plan.blockers).toEqual([]);
  });

  it("blocks a required resume upload when no resume file was built", () => {
    const plan = planFor("greenhouse-style", undefined, undefined, null);
    expect(plan.blockers.some((blocker) => blocker.status === "missing-file")).toBe(true);
  });

  it("blocks a form with no submit button", () => {
    const base = planFor("greenhouse-style");
    const plan = planApplication({
      url: base.url,
      snapshot: { ...base.snapshot, submit: undefined },
      mappings: mapFields(
        base.snapshot,
        profileForGreenhouse(),
        profileForGreenhouse().answerBank,
        settingsWith(),
      ),
      resumeFilePath: "/tmp/resume.pdf",
    });
    expect(plan.blockers.some((blocker) => blocker.status === "no-submit")).toBe(true);
  });

  it("orders actions in page order and uses the right action kind per field type", () => {
    const plan = planFor("greenhouse-style");
    expect(plan.actions[0]?.label).toBe("First Name");
    const kinds = new Map(plan.actions.map((action) => [action.type, action.kind]));
    expect(kinds.get("file")).toBe("upload");
    expect(kinds.get("select")).toBe("select");
    expect(kinds.get("email")).toBe("fill");
  });
});
