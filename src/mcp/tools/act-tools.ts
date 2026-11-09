/**
 * The tools that act: build resumes, read forms and apply, keep the application ledger, read mail
 * and write notes.
 *
 * Why it exists: in autopilot the model decides what to do; these are the capabilities Scout
 * offers for the acting half of the job hunt, each guarded by the rules that protect the owner's
 * data (kill switch, apply level, daily limit, submitted-once, evidence, fact check).
 *
 * Which tool is paused-safe: `build_resume`, `write_note` and the six ledger tools only change
 * local files or the owner's own record and keep working while Scout is paused; `get_form`,
 * `apply_to_job` and `read_inbox` refuse while paused.
 *
 * Example: `createActTools({ apply: { openBrowser, readFormPage } })` builds the tools with a fake
 * browser for a test; `actTools` is the same list with the real browser, download, LaTeX and keychain.
 */
import type { ScoutTool } from "../tool.js";
import { createApplyTools } from "./act-apply-tools.js";
import { ledgerTools } from "./act-ledger-tools.js";
import { mailAndNoteTools } from "./act-mail-note-tools.js";
import { createResumeTools } from "./act-resume-tools.js";
import type { ActToolOptions } from "./act-support.js";

export type { ActToolOptions } from "./act-support.js";

/** Builds every acting tool on the outside effects given. Names are unique. */
export function createActTools(options: ActToolOptions = {}): ScoutTool[] {
  return [
    ...createResumeTools(options),
    ...createApplyTools(options),
    ...ledgerTools,
    ...mailAndNoteTools,
  ];
}

/** The acting tools with the real browser, page download, LaTeX and keychain. */
export const actTools: ScoutTool[] = createActTools();
