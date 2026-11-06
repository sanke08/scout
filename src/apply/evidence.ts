/**
 * Saves the proof of one application attempt into a folder (IDEA 5.11): the form as seen, the
 * values filled, the screenshots, the confirmation text, the timestamps and the profile version.
 *
 * Why: "applied" is only ever set with evidence, and a later interview needs to know exactly what
 * was sent. The folder is created by another module; this one is given the directory.
 *
 * Example: `saveEvidence("/data/jobs/2026-01-10_examplecorp_backend/evidence", {...})` writes
 * `form-snapshot.json`, `filled-values.json`, `screenshot-before-submit.png`, `confirmation.txt`
 * and `evidence.json`, and returns their paths. Saving twice into one folder overwrites, so the
 * pre-submit copy is replaced by the final one once the confirmation is known.
 * Failure: a folder that cannot be written throws; the caller must not submit in that case.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScoutError } from "../shared/index.js";
import type { FormSnapshot } from "./form-types.js";

/** Everything worth keeping about one attempt. Optional parts are written only when present. */
export interface EvidenceInput {
  snapshot: FormSnapshot;
  /** Field key to the value Scout filled. */
  filledValues: Record<string, string>;
  /** PNG bytes of the filled form, taken before any submit. */
  screenshotBeforeSubmit?: Uint8Array;
  /** PNG bytes of the page after the submit. */
  screenshotAfterSubmit?: Uint8Array;
  /** The page text shown after the submit. */
  confirmationText?: string;
  /** ISO time the attempt began. */
  startedAt: string;
  /** ISO time the attempt ended, once known. */
  finishedAt?: string;
  /** The `version` of the profile used, so the attempt can be traced to what the profile said. */
  profileVersion: number;
  /** What happened, in a few words, for example `"filled-for-review"` or `"applied"`. */
  outcome: string;
}

/** Writes JSON with two-space indentation so a person can read it. */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Saves the evidence under `directory` (created if missing) and returns the paths written. */
export function saveEvidence(directory: string, evidence: EvidenceInput): string[] {
  if (directory.trim() === "") {
    throw new ScoutError(
      "invalid-input",
      "Evidence needs a folder to be saved in, but the folder path was empty.",
    );
  }
  mkdirSync(directory, { recursive: true });
  const written: string[] = [];

  const snapshotPath = join(directory, "form-snapshot.json");
  writeJson(snapshotPath, evidence.snapshot);
  written.push(snapshotPath);

  const valuesPath = join(directory, "filled-values.json");
  writeJson(valuesPath, evidence.filledValues);
  written.push(valuesPath);

  if (evidence.screenshotBeforeSubmit !== undefined) {
    const path = join(directory, "screenshot-before-submit.png");
    writeFileSync(path, evidence.screenshotBeforeSubmit);
    written.push(path);
  }
  if (evidence.screenshotAfterSubmit !== undefined) {
    const path = join(directory, "screenshot-after-submit.png");
    writeFileSync(path, evidence.screenshotAfterSubmit);
    written.push(path);
  }
  if (evidence.confirmationText !== undefined) {
    const path = join(directory, "confirmation.txt");
    writeFileSync(path, evidence.confirmationText, "utf8");
    written.push(path);
  }

  const metaPath = join(directory, "evidence.json");
  writeJson(metaPath, {
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt ?? null,
    profileVersion: evidence.profileVersion,
    outcome: evidence.outcome,
    formShapeHash: evidence.snapshot.hash,
    files: written.map((path) => path.slice(directory.length + 1)),
  });
  written.push(metaPath);
  return written;
}
