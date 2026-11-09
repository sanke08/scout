/**
 * Registers the apply-related commands: `approve`, `skip`, `undo`, `apply` and `apply self-test`.
 *
 * Why it is one function: `src/index.ts` needs a single line to add all of them. Nothing here
 * defines a flag that answers for the user: the final click at level Automatic needs a `yes`
 * typed for each job, and no option can stand in for it.
 */
import type { Command } from "commander";
import type { ApplicationOptions } from "../application.js";
import { resolveVault } from "../../platforms/index.js";
import { resolveApplyEnvironment } from "./apply-environment.js";
import { registerApprovalCommands } from "./apply-approval.js";
import { runApplyCommand, type ApplyCommandOptions } from "./apply-run.js";
import { runSelfTestCommand, type SelfTestCommandOptions } from "./apply-self-test.js";
import { withApplication } from "./with-application.js";

/** Adds the commands listed in the file comment. `overrides` are passed to every application and carry the test fakes. */
export function registerApplyCommands(program: Command, overrides: ApplicationOptions = {}): void {
  registerApprovalCommands(program, overrides);
  const environment = resolveApplyEnvironment(overrides.apply);
  const vault = resolveVault(overrides.platforms);

  const apply = program
    .command("apply")
    .description(
      "Prepare or fill the application for a job, as far as the board's level in Settings allows.",
    )
    .argument("<jobId>", "the job's id, as shown by `scout jobs`")
    .option("--url <address>", "the application page, when it differs from the job's own address")
    .option("--dry-run", "fill and check everything but never submit")
    .option(
      "--profile-dir <folder>",
      "Scout's own browser profile folder (default: <data>/browser-profile)",
    )
    .option(
      "--wait <seconds>",
      "how long to wait for the confirmation after you press submit (default 600; 0 = do not wait)",
    )
    .action((jobId: string, options: ApplyCommandOptions) =>
      withApplication(overrides, (application) =>
        runApplyCommand(application, environment, jobId, options, vault),
      ),
    );

  apply
    .command("self-test")
    .description(
      "Dry-run a saved form page or a stable public posting to check a board still works.",
    )
    .argument("<fixtureOrUrl>", "a saved page file or an http(s) address")
    .option("--board <kind>", "the board kind, when it cannot be told from the target")
    .option("--profile-file <file>", "a test profile to fill with (default: the fictional sample)")
    .option("--expected-shape <hash>", "fail when the form's shape hash differs from this one")
    .option(
      "--profile-dir <folder>",
      "Scout's own browser profile folder (default: <data>/browser-profile)",
    )
    .action((target: string, options: SelfTestCommandOptions) =>
      withApplication(overrides, (application) =>
        runSelfTestCommand(application, environment, target, options),
      ),
    );
}
