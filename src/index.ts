#!/usr/bin/env node
/**
 * The command-line entry point. It holds only parsing and printing; every operation lives in a
 * module under `src/` so a second caller (the web page) can reuse it.
 *
 * Run `npm run dev -- version` while developing, or `scout version` after `npm run build`.
 */
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { registerCommands, type ApplicationOptions } from "./app/index.js";
import { registerFoldersCommands } from "./app/index.js";
import { registerApplyCommands } from "./app/index.js";
import { ScoutError } from "./shared/index.js";
import { registerMailAndNotesCommands } from "./app/index.js";

/** Reads the version from package.json so there is one source of truth. */
export function readVersion(): string {
  const manifest = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  return parsed.version;
}

/**
 * Builds the command tree. `overrides` replace the real network, model, clock and folders of the
 * application; the real program passes none, tests pass fakes.
 */
export function buildProgram(overrides: ApplicationOptions = {}): Command {
  const program = new Command();
  program.exitOverride();
  program
    .name("scout")
    .description(
      "A local job-hunting pipeline: one editable profile, one-page resumes, human approval.",
    )
    .version(readVersion(), "-v, --version");

  program
    .command("version")
    .description("Print the Scout version.")
    .action(() => {
      console.log(readVersion());
    });

  registerCommands(program, overrides);
  registerFoldersCommands(program, overrides);
  registerMailAndNotesCommands(program, overrides);
  registerApplyCommands(program, overrides);
  return program;
}

/**
 * Runs the program and turns a `ScoutError` into a readable message and an exit code. A usage
 * mistake (unknown command, missing argument) was already explained by the command parser; only
 * its exit code is kept. `overrides` are for tests, see `buildProgram`.
 */
export async function main(argv: string[], overrides: ApplicationOptions = {}): Promise<void> {
  try {
    await buildProgram(overrides).parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof ScoutError) {
      console.error(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv);
}
