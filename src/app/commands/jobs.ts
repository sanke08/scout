/**
 * `scout jobs [--status S]` and `scout digest`: look at stored jobs from the command line.
 *
 * Why they exist: nothing Scout decides may be silent. `jobs` shows every job with the reason for
 * its status (for a skipped job, the hard-rule reasons); `digest` shows the shortlisted cards the
 * web page would show.
 */
import type { Command } from "commander";
import { isJobStatus, JOB_STATUSES, ScoutError, type JobRecord } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { createDigestProvider } from "../digest-provider.js";
import { withApplication } from "./with-application.js";

/** One job as one line plus its reason, e.g. `skipped  Examplecorp - Senior Backend Engineer (Berlin) [id]`. */
export function describeJob(job: JobRecord): string[] {
  const lines = [
    `${job.status.padEnd(12)} ${job.company} - ${job.title} (${job.location}) [${job.id}]`,
  ];
  if (job.statusReason !== undefined) lines.push(`             why: ${job.statusReason}`);
  return lines;
}

/** Registers `jobs` and `digest` on the program. */
export function registerJobs(program: Command, overrides: ApplicationOptions): void {
  program
    .command("jobs")
    .description("List stored jobs with the reason for each status.")
    .option("--status <status>", `only jobs in this status (${JOB_STATUSES.join(", ")})`)
    .action((options: { status?: string }) =>
      withApplication(overrides, (application) => {
        if (options.status !== undefined && !isJobStatus(options.status)) {
          throw new ScoutError(
            "invalid-input",
            `"${options.status}" is not a job status. Use one of: ${JOB_STATUSES.join(", ")}.`,
          );
        }
        const jobs = application.jobStore.list(
          options.status === undefined
            ? {}
            : { status: options.status as (typeof JOB_STATUSES)[number] },
        );
        if (jobs.length === 0) {
          console.log("No jobs to show. Run `scout discover` to look for some.");
          return;
        }
        for (const job of jobs) {
          for (const line of describeJob(job)) console.log(line);
        }
        console.log(`${jobs.length} job(s).`);
      }),
    );

  program
    .command("digest")
    .description("Print the shortlisted jobs, best first, as plain text.")
    .option("--resume", "also print the resume text built for each job")
    .action((options: { resume?: boolean }) =>
      withApplication(overrides, async (application) => {
        const cards = await createDigestProvider(application)();
        if (cards.length === 0) {
          console.log("Nothing is shortlisted. Run `scout discover`, or check `scout jobs`.");
          return;
        }
        cards.forEach((card, position) => {
          const job = card.job;
          console.log(
            `${position + 1}. ${job.title} at ${job.company} (${job.location}) - score ${Math.round(card.shortlistScore)}`,
          );
          console.log(`   ${job.canonicalUrl}`);
          for (const reason of card.reasons) console.log(`   + ${reason}`);
          for (const unmet of card.unmet) console.log(`   - missing: ${unmet}`);
          if (options.resume === true) console.log(`\n${card.resumePreview}\n`);
        });
        console.log("Run `scout serve` to approve or skip these in the Digest page.");
      }),
    );
}
