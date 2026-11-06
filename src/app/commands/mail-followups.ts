/**
 * `scout followups` and `scout funnel`: what to chase, and how the pipeline is doing.
 *
 * Why they exist: scenario M. `followups` lists applied jobs that have had no reply for the
 * number of days in the settings and prints a ready draft for each; Scout never sends it, the
 * user does. `funnel` counts how jobs moved through the stages, from the stored jobs and the
 * action log, so the user can see where applications stall.
 */
import type { Command } from "commander";
import type { Funnel, FunnelCounts } from "../../tracking/index.js";
import { AGE_BUCKETS, buildFunnel, daysWithoutReply, draftFollowUp } from "../../tracking/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** How many action log entries the funnel reads: far more than a person's search will produce. */
export const FUNNEL_LOG_LIMIT = 1_000_000;

/** Prints the drafts for every applied job that is due, longest wait first. */
function printFollowUps(application: Application): void {
  const settings = application.settingsStore.load();
  const profile = application.profileStore.load();
  const now = application.now();
  const due = application.jobStore
    .list({ status: ["applied"] })
    .map((job) => ({ job, days: daysWithoutReply(job, now) ?? 0 }))
    .sort((first, second) => second.days - first.days);
  let shown = 0;
  for (const { job } of due) {
    const draft = draftFollowUp(job, profile, settings, now);
    if (draft === undefined) continue;
    shown += 1;
    console.log(
      `${job.company} - ${job.title} [${job.id}]: no reply for ${draft.daysWithoutReply} days`,
    );
    console.log(`  Subject: ${draft.subject}`);
    console.log(draft.emailBody.replace(/^/gm, "  | "));
    console.log(`  Connection note: ${draft.connectionNote}`);
    console.log("");
  }
  if (shown === 0) {
    console.log(
      `No applied job has waited ${settings.followUpAfterDays} days or more without a reply, so no follow-up is due.`,
    );
    return;
  }
  console.log(`${shown} draft(s). Scout never sends mail: copy a draft and send it yourself.`);
}

/** One funnel row: a label and the six counts in a fixed column layout. */
function countsRow(label: string, counts: FunnelCounts): string {
  return [
    label.padEnd(18),
    String(counts.discovered).padStart(10),
    String(counts.shortlisted).padStart(11),
    String(counts.applied).padStart(8),
    String(counts.replied).padStart(8),
    String(counts.interviewing).padStart(13),
    String(counts.offered).padStart(8),
  ].join(" ");
}

/** Prints the funnel as three small tables. */
function printFunnel(funnel: Funnel): void {
  const header = `${"".padEnd(18)} ${"discovered".padStart(10)} ${"shortlisted".padStart(11)} ${"applied".padStart(8)} ${"replied".padStart(8)} ${"interviewing".padStart(13)} ${"offered".padStart(8)}`;
  console.log("Funnel: how jobs moved through the pipeline");
  console.log(header);
  console.log(countsRow("all jobs", funnel.total));
  const boards = Object.entries(funnel.byBoard);
  if (boards.length > 0) {
    console.log("");
    console.log("By source (board kind):");
    for (const [kind, counts] of boards) console.log(countsRow(kind, counts));
  }
  console.log("");
  console.log("By posting age when you applied:");
  for (const bucket of AGE_BUCKETS) {
    const counts = funnel.byPostingAge[bucket];
    console.log(
      `${bucket.padEnd(18)} applied ${String(counts.applied).padStart(3)}, replied ${String(counts.replied).padStart(3)}`,
    );
  }
}

/** Registers `followups` and `funnel` on the program. */
export function registerFollowUps(program: Command, overrides: ApplicationOptions): void {
  program
    .command("followups")
    .description("List applied jobs due for a follow-up and print drafts (never sent).")
    .action(() => withApplication(overrides, printFollowUps));

  program
    .command("funnel")
    .description("Print how jobs moved through the pipeline, by source and posting age.")
    .action(() =>
      withApplication(overrides, (application) =>
        printFunnel(
          buildFunnel(application.jobStore.list(), application.actionLog.recent(FUNNEL_LOG_LIMIT)),
        ),
      ),
    );
}
