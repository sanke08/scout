/**
 * `scout leads add --from FILE --source NAME` and `scout leads list`: a minimal leads file.
 *
 * Why it exists: a lead is a job found but not yet picked. The user (or another tool) can hand
 * Scout a JSON list of them and get a dated, readable Markdown table back in `leads/`. Scout adds
 * nothing to the rows: the list is written as given, and rows are never made into jobs.
 *
 * Example: `scout leads add --from rows.json --source remote-feed` writes
 * `leads/2026-11-07_remote-feed-round1.md`; `scout leads list` prints the newest file.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { latestLeadsFile, writeLeadsFile } from "../../folders/index.js";
import { ScoutError } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { resolveDataFolder } from "./folders-directory.js";

/** One row of the input file. Only company and role are required. */
const leadRowSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  link: z.string().optional(),
  location: z.string().default("unknown"),
  experience: z.string().default("unknown"),
  listedSkills: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

/** The input file: a list of rows. */
const leadRowsSchema = z.array(leadRowSchema);

/** Reads and checks the rows; a file that is missing, not JSON or the wrong shape is `invalid-input`. */
function readLeadRows(path: string): z.infer<typeof leadRowsSchema> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ScoutError("not-found", `The leads file ${path} could not be read. Check the path.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ScoutError("invalid-input", `The leads file ${path} is not valid JSON.`);
  }
  const checked = leadRowsSchema.safeParse(parsed);
  if (!checked.success) {
    const problem = checked.error.issues[0];
    throw new ScoutError(
      "invalid-input",
      `The leads file ${path} must be a list of rows with a company and a role. Problem at "${problem?.path.join(".") ?? ""}": ${problem?.message ?? "unknown"}.`,
    );
  }
  return checked.data;
}

/** Registers `leads add` and `leads list` on the program. */
export function registerLeads(program: Command, overrides: ApplicationOptions): void {
  const leads = program
    .command("leads")
    .description("Keep dated lists of jobs found but not picked yet.");

  leads
    .command("add")
    .description("Write a leads file from rows in a JSON file.")
    .requiredOption("--from <file>", "JSON file holding a list of leads")
    .option(
      "--source <name>",
      "name of where the rows came from (letters, digits, hyphens)",
      "manual",
    )
    .action((options: { from: string; source: string }) => {
      const rows = readLeadRows(resolve(options.from));
      const now = overrides.now ?? ((): Date => new Date());
      const saved = writeLeadsFile(
        join(resolveDataFolder(overrides), "leads"),
        options.source,
        now(),
        rows,
      );
      console.log(`Wrote ${rows.length} lead(s) to ${saved.path} (round ${saved.round}).`);
    });

  leads
    .command("list")
    .description("Print the newest leads file.")
    .option("--source <name>", "only the newest file of this source")
    .action((options: { source?: string }) => {
      const path = latestLeadsFile(join(resolveDataFolder(overrides), "leads"), options.source);
      if (path === undefined) {
        console.log("There are no leads yet. Run `scout leads add --from FILE`.");
        return;
      }
      console.log(path);
      console.log(readFileSync(path, "utf8"));
    });
}
