import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ScoutError } from "../shared/index.js";
import { createFakeVault } from "./fake-vault.js";
import {
  applyPlatformChoice,
  assertSavedLoginPossible,
  confirmationMatches,
  describePlatformChoice,
  isRiskyPlatformChoice,
} from "./platform-choice.js";

describe("isRiskyPlatformChoice", () => {
  it("is risky only for saved sign-in or automatic level on a known platform", () => {
    expect(isRiskyPlatformChoice("linkedin", { login: "saved" })).toBe(true);
    expect(isRiskyPlatformChoice("indeed", { level: "auto" })).toBe(true);
    expect(isRiskyPlatformChoice("naukri", { login: "manual", level: "fill" })).toBe(false);
    expect(isRiskyPlatformChoice("example", { login: "saved", level: "auto" })).toBe(false);
  });
});

describe("confirmationMatches", () => {
  it("accepts the platform name ignoring spaces and capitals, and nothing else", () => {
    expect(confirmationMatches("linkedin", " LinkedIn ")).toBe(true);
    expect(confirmationMatches("linkedin", "yes")).toBe(false);
    expect(confirmationMatches("linkedin", "")).toBe(false);
    expect(confirmationMatches("linkedin", undefined)).toBe(false);
  });
});

describe("assertSavedLoginPossible", () => {
  it("refuses saved sign-in for an unknown platform or without a keychain", () => {
    const vault = createFakeVault();
    expect(() => assertSavedLoginPossible("example", { login: "saved" }, vault)).toThrow(
      ScoutError,
    );
    const noKeychain = createFakeVault({ supported: false });
    expect(() => assertSavedLoginPossible("linkedin", { login: "saved" }, noKeychain)).toThrow(
      /no keychain/,
    );
    expect(() => assertSavedLoginPossible("linkedin", { login: "saved" }, vault)).not.toThrow();
    expect(() => assertSavedLoginPossible("example", { level: "fill" }, vault)).not.toThrow();
  });
});

describe("applyPlatformChoice", () => {
  it("writes only what was chosen and leaves the input alone", () => {
    const before = { ...DEFAULT_SETTINGS, boardLevels: { greenhouse: "fill" as const } };
    const after = applyPlatformChoice(before, "linkedin", { login: "saved" });
    expect(after.platformLogins).toEqual({ linkedin: "saved" });
    expect(after.boardLevels).toEqual({ greenhouse: "fill" });
    expect(before.platformLogins).toEqual({});
    expect(applyPlatformChoice(after, "linkedin", { level: "fill" }).boardLevels).toEqual({
      greenhouse: "fill",
      linkedin: "fill",
    });
  });

  it("describes a change in one line", () => {
    expect(describePlatformChoice("indeed", { level: "fill" })).toBe(
      "indeed: login unchanged, level fill.",
    );
  });
});
