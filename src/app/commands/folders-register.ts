/** Registers the job-folder and operations commands. One call from `src/index.ts`. */
import type { Command } from "commander";
import type { ApplicationOptions } from "../application.js";
import { registerBackupAndRestore } from "./folders-backup.js";
import { registerBoardAndStatus } from "./folders-board.js";
import { registerLeads } from "./folders-leads.js";
import { registerService } from "./folders-service.js";

/**
 * Adds `board`, `status`, `backup`, `restore`, `leads` and `service`. (`resume --job` is an option
 * of the existing `resume` command.) `overrides` are for tests, as in `registerCommands`.
 */
export function registerFoldersCommands(
  program: Command,
  overrides: ApplicationOptions = {},
): void {
  registerBoardAndStatus(program, overrides);
  registerBackupAndRestore(program, overrides);
  registerLeads(program, overrides);
  registerService(program, overrides);
}
