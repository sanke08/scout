import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { profileSchema, type Profile } from "../shared/index.js";
import { missingRequiredFields } from "./first-run.js";

/** The fictional sample profile every test starts from. */
function sampleProfile(): Profile {
  const text = readFileSync(new URL("../../fixtures/profile.sample.json", import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(text));
}

/** The paths reported missing for a profile. */
function missingPaths(profile: Profile): string[] {
  return missingRequiredFields(profile).map((field) => field.path);
}

describe("missingRequiredFields", () => {
  it("is empty for a complete profile", () => {
    expect(missingRequiredFields(sampleProfile())).toEqual([]);
  });

  it("lists every required field of an empty profile, each with a question", () => {
    const base = sampleProfile();
    const empty: Profile = {
      ...base,
      identity: { name: "  ", location: "" },
      preferences: {
        ...base.preferences,
        targetRoles: [],
        locations: [" "],
        salaryFloor: undefined,
        noticePeriodDays: undefined,
        workAuthorization: [],
      },
    };
    const missing = missingRequiredFields(empty);
    expect(missing.map((field) => field.path).sort()).toEqual(
      [
        "identity.location",
        "identity.name",
        "preferences.locations",
        "preferences.noticePeriodDays",
        "preferences.salaryFloor",
        "preferences.targetRoles",
        "preferences.workAuthorization",
      ].sort(),
    );
    for (const field of missing) {
      expect(field.question).toMatch(/\?$/);
    }
  });

  it("reports only the one field that is missing", () => {
    const base = sampleProfile();
    const withoutSalary = { ...base, preferences: { ...base.preferences, salaryFloor: undefined } };
    expect(missingPaths(withoutSalary)).toEqual(["preferences.salaryFloor"]);
  });

  it("counts a notice period of zero days as filled", () => {
    const base = sampleProfile();
    const immediate = { ...base, preferences: { ...base.preferences, noticePeriodDays: 0 } };
    expect(missingPaths(immediate)).toEqual([]);
  });
});
