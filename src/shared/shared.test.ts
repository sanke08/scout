import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  JOB_STATUSES,
  ScoutError,
  isJobStatus,
  profileSchema,
  redact,
  settingsSchema,
  DEFAULT_SETTINGS,
} from "./index.js";

describe("job statuses", () => {
  it("has one list with no duplicates", () => {
    expect(new Set(JOB_STATUSES).size).toBe(JOB_STATUSES.length);
  });

  it("recognises known and unknown statuses", () => {
    expect(isJobStatus("applied")).toBe(true);
    expect(isJobStatus("submitted")).toBe(false);
  });
});

describe("sample profile fixture", () => {
  it("is valid against the profile schema", () => {
    const raw = readFileSync(
      new URL("../../fixtures/profile.sample.json", import.meta.url),
      "utf8",
    );
    expect(() => profileSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it("uses only fictional contact details", () => {
    const raw = readFileSync(
      new URL("../../fixtures/profile.sample.json", import.meta.url),
      "utf8",
    );
    const profile = profileSchema.parse(JSON.parse(raw));
    expect(profile.identity.email).toMatch(/@example\.com$/);
  });
});

describe("settings defaults", () => {
  it("are valid and safe", () => {
    expect(() => settingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
    expect(DEFAULT_SETTINGS.applyMode).toBe("approve");
    expect(DEFAULT_SETTINGS.automationPaused).toBe(false);
  });
});

describe("errors and logging", () => {
  it("maps every error code to a non-zero exit code", () => {
    for (const code of Object.keys(EXIT_CODES) as (keyof typeof EXIT_CODES)[]) {
      expect(new ScoutError(code, "x").exitCode).toBeGreaterThan(1);
    }
  });

  it("hides secret-looking fields", () => {
    expect(redact({ apiKey: "abc", board: "acme" })).toEqual({ apiKey: "[hidden]", board: "acme" });
  });
});
