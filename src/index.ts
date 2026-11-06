#!/usr/bin/env node
/**
 * The command-line entry point. It holds only parsing and printing; every operation lives in a
 * module under `src/` so a second caller (the web page) can reuse it.
 *
 * Run `npm run dev -- version` while developing, or `scout version` after `npm run build`.
 */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { ScoutError } from "./shared/index.js";

/** Reads the version from package.json so there is one source of truth. */
export function readVersion(): string {
  const manifest = new URL("../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  return parsed.version;
}

/** Builds the command tree. Module commands are added here as each module is wired in. */
export function buildProgram(): Command {
  const program = new Command();
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

  return program;
}

/** Runs the program and turns a `ScoutError` into a readable message and an exit code. */
export async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
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
