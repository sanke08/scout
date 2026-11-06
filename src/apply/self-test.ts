/**
 * A board self-test: a dry run on a stable public posting that says whether the board's adapter
 * still works (IDEA 5.10 "Self-tests", Scenario P).
 *
 * Why: when a site renames a button or adds a field, the saved form shape changes. A daily dry
 * run notices that before a real application hits it, so a caller can pause automatic
 * submission for that board and keep staging applications for manual submit.
 *
 * Example: `runSelfTest(driver, { url, profile, settings, expectedShapeHash })` returns
 * `{ passed: true, reasons: [], shapeHash }` when the page opens, shows no bot check, matches the
 * saved shape, maps without blockers, and fills and reads back cleanly. Otherwise `passed` is
 * false and `reasons` says why. This function has no way to submit: it never calls
 * `driver.submit` and has no job to change.
 */
import type { Profile, Settings } from "../shared/index.js";
import type { BrowserDriver } from "./driver.js";
import { fillAndVerify } from "./fill-engine.js";
import { mapFields } from "./map-fields.js";
import { detectPageBlocker } from "./page-checks.js";
import { planApplication } from "./plan.js";
import { snapshotForm } from "./snapshot.js";

/** The stable page to test and what to test it with. All data is a test profile, never real. */
export interface SelfTestFixture {
  /** Address of a stable public posting's application form. */
  url: string;
  profile: Profile;
  settings: Settings;
  /** The shape hash saved from the last good run. When absent, the shape is not compared. */
  expectedShapeHash?: string;
  /** A resume file to attach, when the form asks for one. */
  resumeFilePath?: string;
}

/** The verdict. `passed` false means a caller should pause automatic submission for the board. */
export interface SelfTestResult {
  passed: boolean;
  /** Full sentences saying what failed; empty when `passed` is true. */
  reasons: string[];
  /** The shape hash seen now, to save as the next expected one after a human approves a change. */
  shapeHash?: string;
}

/** Runs the dry run described in the file comment and always closes the driver. */
export async function runSelfTest(
  driver: BrowserDriver,
  fixture: SelfTestFixture,
): Promise<SelfTestResult> {
  try {
    await driver.open(fixture.url);
    const html = await driver.pageHtml();
    const blocker = detectPageBlocker(await driver.pageText(), html);
    if (blocker !== undefined) return { passed: false, reasons: [blocker.reason] };

    const snapshot = snapshotForm(html);
    if (fixture.expectedShapeHash !== undefined && snapshot.hash !== fixture.expectedShapeHash) {
      return {
        passed: false,
        reasons: [
          "The form's shape differs from the saved one, so the board's adapter may be out of date.",
        ],
        shapeHash: snapshot.hash,
      };
    }
    const mappings = mapFields(
      snapshot,
      fixture.profile,
      fixture.profile.answerBank,
      fixture.settings,
    );
    const planInput = { url: fixture.url, snapshot, mappings };
    const plan = planApplication(
      fixture.resumeFilePath === undefined
        ? planInput
        : { ...planInput, resumeFilePath: fixture.resumeFilePath },
    );
    if (plan.blockers.length > 0) {
      return {
        passed: false,
        reasons: plan.blockers.map((entry) => `${entry.label}: ${entry.reason}`),
        shapeHash: snapshot.hash,
      };
    }
    const outcome = await fillAndVerify(driver, plan);
    if (outcome.mismatches.length > 0) {
      return {
        passed: false,
        reasons: outcome.mismatches.map(
          (entry) => `After filling, "${entry.label}" held a different value than intended.`,
        ),
        shapeHash: snapshot.hash,
      };
    }
    return { passed: true, reasons: [], shapeHash: snapshot.hash };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { passed: false, reasons: [`The self-test could not run to the end: ${detail}`] };
  } finally {
    try {
      await driver.close();
    } catch {
      // Closing a page that is already gone is not a test failure.
    }
  }
}
