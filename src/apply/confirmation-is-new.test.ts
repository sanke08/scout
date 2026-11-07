import { describe, expect, it } from "vitest";
import { confirmationIsNew } from "./page-checks.js";

describe("confirmationIsNew", () => {
  it("is true when the confirmation appears after the submit", () => {
    expect(confirmationIsNew("Fill in the form", "Thank you for applying!")).toBe(true);
  });

  it("is false when the same confirmation text was already on the form", () => {
    const before = "Thank you for applying to Acme! Fill in the form below.";
    expect(confirmationIsNew(before, `${before} Email is required.`)).toBe(false);
    expect(confirmationIsNew(before, before)).toBe(false);
  });

  it("is false for a failure message", () => {
    expect(confirmationIsNew("form", "Your application was not successfully submitted.")).toBe(
      false,
    );
  });
});
