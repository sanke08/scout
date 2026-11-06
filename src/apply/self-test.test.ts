import { describe, expect, it } from "vitest";
import { runSelfTest, type SelfTestFixture } from "./self-test.js";
import { snapshotForm } from "./snapshot.js";
import { driverFor, formHtml, profileForGreenhouse, settingsWith } from "./test-helpers.js";

/** A fixture for the Greenhouse-style page that should pass. */
function greenhouseFixture(overrides: Partial<SelfTestFixture> = {}): SelfTestFixture {
  return {
    url: "https://example.com/jobs/stable/apply",
    profile: profileForGreenhouse(),
    settings: settingsWith(),
    resumeFilePath: "/tmp/Alex_Rivera_ExampleCorp.pdf",
    expectedShapeHash: snapshotForm(formHtml("greenhouse-style")).hash,
    ...overrides,
  };
}

describe("runSelfTest", () => {
  it("passes on a stable page and never submits", async () => {
    const driver = driverFor("greenhouse-style");
    const result = await runSelfTest(driver, greenhouseFixture());
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    expect(driver.calls.at(-1)).toBe("close");
  });

  it("fails when a button was renamed, which changes the form's shape (Scenario P)", async () => {
    const renamed = formHtml("greenhouse-style").replace("Submit Application", "Send it now");
    const driver = driverFor("greenhouse-style", { html: renamed });
    const result = await runSelfTest(driver, greenhouseFixture());
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toMatch(/shape differs/);
    expect(driver.calls.some((call) => /^(fill|select|upload|submit) /.test(call))).toBe(false);
  });

  it("fails on a bot check without touching the form", async () => {
    const driver = driverFor("greenhouse-style", { pageText: "Please verify you are human." });
    const result = await runSelfTest(driver, greenhouseFixture());
    expect(result.passed).toBe(false);
    expect(driver.calls.some((call) => /^(fill|select|upload|submit) /.test(call))).toBe(false);
  });

  it("fails when the profile leaves a required question unanswered", async () => {
    const profile = profileForGreenhouse();
    profile.answerBank = [];
    const result = await runSelfTest(driverFor("greenhouse-style"), greenhouseFixture({ profile }));
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("fails when a filled value does not read back", async () => {
    const driver = driverFor("greenhouse-style", {
      corruptions: { '[name="job_application[email]"]': "wrong@example.com" },
    });
    const result = await runSelfTest(driver, greenhouseFixture());
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toMatch(/Email/);
  });

  it("fails, instead of throwing, when the page cannot be opened", async () => {
    const result = await runSelfTest(
      driverFor("greenhouse-style", { openThrows: true }),
      greenhouseFixture(),
    );
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toMatch(/could not run to the end/);
  });
});
