/**
 * `scout discover`: runs one discovery pass and prints what happened.
 *
 * Why it exists: scenarios D and E from the command line. The summary says plainly when Scout
 * worked in degraded mode (no model), so a shortlist made on keywords alone is never mistaken
 * for a scored one.
 */
import type { Command } from "commander";
import type { ApplicationOptions } from "../application.js";
import { runDiscoveryPass, type DiscoveryPassSummary } from "../discovery-pass.js";
import { withApplication } from "./with-application.js";

/** Prints a summary as plain lines. */
export function printSummary(summary: DiscoveryPassSummary): void {
  if (summary.mode === "degraded") {
    console.log(
      "MODE: degraded. The model could not be used, so keyword score alone decided the shortlist.",
    );
  } else {
    console.log("Mode: model scoring.");
  }
  console.log(`Boards read: ${summary.boardsRead}, failed: ${summary.boardsFailed.length}`);
  console.log(
    `Postings fetched: ${summary.postingsFetched}, after merging duplicates: ${summary.postingsAfterDedupe}`,
  );
  console.log(
    `Dropped by hard rules (reasons are kept, see "scout jobs --status skipped"): ${summary.droppedByRules}`,
  );
  console.log(`Kept after rules: ${summary.keptAfterRules}`);
  console.log(`Scored by the model: ${summary.scoredByModel}`);
  console.log(`Shortlisted: ${summary.shortlisted}`);
  console.log(`Kept for review: ${summary.keptForReview}`);
  console.log(`Skipped by score: ${summary.skippedByScore}`);
  console.log(`Waiting for scoring: ${summary.waitingForScoring}`);
  for (const reason of summary.reasons) {
    console.log(`Note: ${reason}`);
  }
}

/** Registers `discover` on the program. */
export function registerDiscover(program: Command, overrides: ApplicationOptions): void {
  program
    .command("discover")
    .description("Read your boards once, apply the hard rules, and shortlist the best jobs.")
    .action(() =>
      withApplication(overrides, async (application) => {
        printSummary(await runDiscoveryPass(application));
      }),
    );
}
