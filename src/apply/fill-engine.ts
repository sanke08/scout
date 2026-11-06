/**
 * The two-pass fill: write every planned value, then read every field back and compare.
 *
 * Why: IDEA 5.10 says any mismatch after filling stops the submit. A page script can reformat or
 * drop a value; reading back is the only proof the form holds what Scout meant.
 *
 * Example: after filling email with "alex@example.com", if the page reads back "alex@example.co",
 * `fillAndVerify` reports one mismatch and the caller must stop.
 * This file never presses submit; the driver call for that lives only in `run-application.ts`.
 */
import { basename } from "node:path";
import { tidyText } from "./snapshot.js";
import type { BrowserDriver } from "./driver.js";
import type { FillAction, FillPlan } from "./plan.js";

/** One field whose read-back value differs from the intended one. */
export interface Mismatch {
  fieldKey: string;
  label: string;
  expected: string;
  actual: string;
}

/** What the two-pass fill found. `filled` is what was intended; `readBack` is what the page held. */
export interface FillOutcome {
  filled: Record<string, string>;
  readBack: Record<string, string>;
  mismatches: Mismatch[];
}

/** What a field should read back as: a file input shows only the file's name. */
function expectedReadBack(action: FillAction): string {
  return action.kind === "upload" ? basename(action.value) : action.value;
}

/** Performs one action with the driver. */
async function perform(driver: BrowserDriver, action: FillAction): Promise<void> {
  if (action.kind === "upload") await driver.upload(action.selector, action.value);
  else if (action.kind === "select") await driver.select(action.selector, action.value);
  else await driver.fill(action.selector, action.value);
}

/**
 * Fills every action of `plan`, then reads each one back and compares (whitespace tidied,
 * otherwise exact). A driver error is not caught here: it rejects and the caller stops.
 */
export async function fillAndVerify(driver: BrowserDriver, plan: FillPlan): Promise<FillOutcome> {
  for (const action of plan.actions) {
    await perform(driver, action);
  }
  const filled: Record<string, string> = {};
  const readBack: Record<string, string> = {};
  const mismatches: Mismatch[] = [];
  for (const action of plan.actions) {
    const expected = expectedReadBack(action);
    const actual = await driver.readValue(action.selector);
    filled[action.fieldKey] = expected;
    readBack[action.fieldKey] = actual;
    if (tidyText(actual) !== tidyText(expected)) {
      mismatches.push({ fieldKey: action.fieldKey, label: action.label, expected, actual });
    }
  }
  return { filled, readBack, mismatches };
}
