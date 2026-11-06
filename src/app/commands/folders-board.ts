/**
 * `scout board` and `scout status`: the job board table and the plain-text health report.
 *
 * Why they exist: the user should see every job and its status in one file they can open
 * (`BOARD.md`), and answer "is Scout running, does anything need me?" without starting the web page.
 *
 * Example: `scout board` writes `jobs/BOARD.md` and prints `Total: 3 jobs (shortlisted 2, applied 1)`.
 */
import { join } from "node:path";
import type { Command } from "commander";
import { BOARD_STATUS_ORDER, renderHealthText, writeBoardTable } from "../../folders/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** Registers `board` and `status` on the program. */
export function registerBoardAndStatus(program: Command, overrides: ApplicationOptions): void {
  program
    .command("board")
    .description("Write the job board table (BOARD.md in the jobs folder) and print the totals.")
    .action(() =>
      withApplication(overrides, (application) => {
        const board = writeBoardTable(join(application.directory, "jobs"));
        console.log(`Wrote ${join(application.directory, "jobs", "BOARD.md")}`);
        for (const status of BOARD_STATUS_ORDER) {
          const count = board.totals[status];
          if (count !== undefined) console.log(`${status}: ${count}`);
        }
        console.log(`Total: ${board.rows.length} job${board.rows.length === 1 ? "" : "s"}`);
        for (const skipped of board.skipped) {
          console.log(`Left out ${skipped.folder}: ${skipped.reason}`);
        }
      }),
    );

  program
    .command("status")
    .description("Show whether Scout is running, the jobs by status and what needs you.")
    .action(() =>
      withApplication(overrides, (application) => {
        console.log(renderHealthText(application.healthReport()));
        console.log(`Boards watched: ${application.boardStore.list().length}.`);
      }),
    );
}
