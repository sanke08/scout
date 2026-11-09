/**
 * `scout approve`, `scout skip` and `scout undo`: the command-line path equal to the Approve, Skip
 * and Undo buttons of the Digest page.
 *
 * Why they exist: approving is the user's explicit yes in code. It only makes a job eligible; it
 * never submits anything (`scout apply` does the work, and only at the levels Settings allow). Each
 * command is a thin call to the job store, so an illegal move gives the store's own full-sentence
 * error and the state machine stays the only place that decides what may follow what.
 */
import type { Command } from "commander";
import { ScoutError, type JobRecord, type JobStatus } from "../../shared/index.js";
import { SKIP_TAGS } from "../../web/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** The skip reason used when `--tag` is not given. It is one of the Digest page's tags. */
const DEFAULT_SKIP_TAG = "Not interested";

/**
 * Where `undo` puts a job back, by its current status. As on the Digest page, an approved or a
 * skipped job goes back to `shortlisted`, the state it was chosen from.
 * Example: undoing an `approved` job gives `shortlisted`.
 */
const UNDO_TARGETS: Partial<Record<JobStatus, JobStatus>> = {
  approved: "shortlisted",
  skipped: "shortlisted",
};

/**
 * The statuses a `needs-you` job may have come from, most advanced first. The store lets a
 * `needs-you` job return only to the status it came from, so trying these in order finds it.
 */
const NEEDS_YOU_RETURN_CHOICES: readonly JobStatus[] = [
  "approved",
  "resume-ready",
  "shortlisted",
  "found",
];

/** One line for the user: `Examplecorp - Backend Engineer [id] is now approved.` */
function describeMove(job: JobRecord): string {
  return `${job.company} - ${job.title} [${job.id}] is now ${job.status}.`;
}

/**
 * Sends a `needs-you` job back to where it came from. The job record does not say where that was,
 * so each possible place is tried; the state machine accepts exactly the one it came from.
 * Failure: when none is accepted, throws the store's own error for the first choice.
 */
function returnFromNeedsYou(
  jobs: { transition: (id: string, to: JobStatus, reason: string) => JobRecord },
  id: string,
): JobRecord {
  let firstError: ScoutError | undefined;
  for (const choice of NEEDS_YOU_RETURN_CHOICES) {
    try {
      return jobs.transition(id, choice, "Put back on the command line after it needed you.");
    } catch (error) {
      if (!(error instanceof ScoutError) || error.code !== "illegal-transition") throw error;
      firstError ??= error;
    }
  }
  throw firstError ?? new ScoutError("illegal-transition", `Job ${id} could not be put back.`);
}

/** Registers `approve`, `skip` and `undo` on the program. */
export function registerApprovalCommands(program: Command, overrides: ApplicationOptions): void {
  program
    .command("approve")
    .description("Approve a resume-ready job. This makes it eligible; it never submits anything.")
    .argument("<jobId>", "the job's id, as shown by `scout jobs`")
    .action((jobId: string) =>
      withApplication(overrides, (application) => {
        const job = application.jobStore.transition(
          jobId,
          "approved",
          "Approved on the command line.",
        );
        console.log(describeMove(job));
        console.log(
          `Nothing was submitted. Run \`scout apply ${job.id}\` to prepare the application; whether Scout may submit is decided by the board's level in Settings.`,
        );
      }),
    );

  program
    .command("skip")
    .description("Skip a job that has not been submitted yet, with a short reason.")
    .argument("<jobId>", "the job's id, as shown by `scout jobs`")
    .option(
      "--tag <tag>",
      `why you skip it (${SKIP_TAGS.join(", ")}); default "${DEFAULT_SKIP_TAG}"`,
    )
    .action((jobId: string, options: { tag?: string }) =>
      withApplication(overrides, (application) => {
        const tag = options.tag ?? DEFAULT_SKIP_TAG;
        if (!(SKIP_TAGS as readonly string[]).includes(tag)) {
          throw new ScoutError(
            "invalid-input",
            `"${tag}" is not a skip reason. Use one of: ${SKIP_TAGS.join(", ")}.`,
          );
        }
        console.log(describeMove(application.jobStore.transition(jobId, "skipped", tag)));
      }),
    );

  program
    .command("undo")
    .description("Take back an approval or a skip (or return a job that needed you).")
    .argument("<jobId>", "the job's id, as shown by `scout jobs`")
    .action((jobId: string) =>
      withApplication(overrides, (application) => {
        const job = application.jobStore.get(jobId);
        if (job === undefined) {
          throw new ScoutError(
            "not-found",
            `No job with id ${jobId} exists. Run \`scout jobs\` to see the ids that do.`,
          );
        }
        if (job.status === "needs-you") {
          console.log(describeMove(returnFromNeedsYou(application.jobStore, jobId)));
          return;
        }
        if (job.status === "submitting") {
          throw new ScoutError(
            "illegal-transition",
            `Job ${jobId} is "submitting": Scout was stopped (or its tool process was killed, which can happen about four seconds after a stop) after the submit marker was written and before the result was read, so nobody knows whether the application was sent. Undo cannot reopen it, because a retry could send it twice. Check the company's page and your email, then record the real result with \`scout applications status ${jobId} applied\` (or \`unverified\` when you cannot tell).`,
          );
        }
        const target = UNDO_TARGETS[job.status];
        if (target === undefined) {
          throw new ScoutError(
            "illegal-transition",
            `Job ${jobId} is "${job.status}", and there is nothing to undo from that status. Undo works on approved, skipped and needs-you jobs.`,
          );
        }
        console.log(
          describeMove(
            application.jobStore.transition(jobId, target, "Undone on the command line."),
          ),
        );
      }),
    );
}
