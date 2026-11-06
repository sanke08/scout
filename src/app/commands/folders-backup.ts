/**
 * `scout backup --to DIR` and `scout restore --from DIR [--overwrite]`.
 *
 * Why they exist: the data folder holds the only copy of the profile, the job database and the
 * job folders. A backup copies an allow list of them (never browser sessions, `.env` files or
 * links); a restore refuses a data folder that already has files unless told to overwrite.
 *
 * These commands do not open the application: opening it would create the database, and a restore
 * into a fresh folder would then always be refused.
 *
 * Example: `scout backup --to /Volumes/Drive/scout` prints the new `scout-backup-2026-11-07_100000` folder.
 */
import type { Command } from "commander";
import { createBackup, restoreBackup } from "../../folders/index.js";
import type { ApplicationOptions } from "../application.js";
import { resolveDataFolder } from "./folders-directory.js";

/** Registers `backup` and `restore` on the program. */
export function registerBackupAndRestore(program: Command, overrides: ApplicationOptions): void {
  program
    .command("backup")
    .description(
      "Copy your profile, settings, database and job folders into a dated backup folder.",
    )
    .requiredOption("--to <folder>", "an existing or new folder outside the data folder")
    .action((options: { to: string }) => {
      const now = overrides.now ?? ((): Date => new Date());
      const result = createBackup({
        dataDirectory: resolveDataFolder(overrides),
        destination: options.to,
        now,
      });
      console.log(`Backup written to ${result.path}`);
      console.log(
        `${result.files.length} file(s) saved. Browser sessions and .env files are never included.`,
      );
    });

  program
    .command("restore")
    .description("Copy a backup back into the data folder (refuses a data folder that has files).")
    .requiredOption("--from <folder>", "a backup folder made by `scout backup`")
    .option("--overwrite", "replace files of the same name in a data folder that already has files")
    .action((options: { from: string; overwrite?: boolean }) => {
      const restored = restoreBackup({
        backupDirectory: options.from,
        dataDirectory: resolveDataFolder(overrides),
        overwrite: options.overwrite === true,
      });
      console.log(`Restored ${restored.length} file(s) into ${resolveDataFolder(overrides)}.`);
    });
}
