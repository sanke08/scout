/**
 * `scout init`: creates the data folder and, only when there is no profile yet, a fictional sample.
 *
 * Why it exists: Scout cannot run without a profile, and a blank file is a poor start. The sample
 * is a made-up person; the command says so, because resumes built from it must never be sent.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { ScoutError } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/**
 * Finds `fixtures/profile.sample.json` by walking up from this file, so it works from source
 * (`src/app/commands`) and from the compiled output (`dist/app/commands`).
 * Failure: throws `ScoutError("not-found")` when the sample is missing from the installation.
 */
export function findSampleProfile(): string {
  let folder = dirname(fileURLToPath(import.meta.url));
  for (let level = 0; level < 6; level += 1) {
    const candidate = join(folder, "fixtures", "profile.sample.json");
    if (existsSync(candidate)) return candidate;
    folder = dirname(folder);
  }
  throw new ScoutError(
    "not-found",
    "The sample profile (fixtures/profile.sample.json) was not found next to this installation. Create profile.json in your data folder by hand.",
  );
}

/** Registers `init` on the program. */
export function registerInit(program: Command, overrides: ApplicationOptions): void {
  program
    .command("init")
    .description("Create the data folder and, if you have no profile, a fictional sample to edit.")
    .action(() =>
      withApplication(overrides, (application) => {
        console.log(`Data folder: ${application.directory}`);
        const settingsFile = join(application.directory, "settings.json");
        if (!existsSync(settingsFile)) {
          application.settingsStore.save(application.settingsStore.load());
          console.log(
            `Created settings: ${settingsFile} (safe defaults; Scout waits for your approval).`,
          );
        }
        if (application.profileStore.exists()) {
          console.log("Your profile already exists, so it was left untouched.");
        } else {
          const profileFile = join(application.directory, "profile.json");
          copyFileSync(findSampleProfile(), profileFile);
          console.log(`Created profile: ${profileFile}`);
          console.log(
            "IMPORTANT: this profile is a FICTIONAL SAMPLE (Alex Rivera, example.com). Replace it with your own details before you use any resume it builds.",
          );
        }
        console.log("");
        console.log("Next steps:");
        console.log("  1. Edit profile.json (or run `scout serve` and use the Profile page).");
        console.log("  2. scout profile validate");
        console.log("  3. scout boards add greenhouse <company-token>");
        console.log("  4. scout discover");
        console.log("  5. scout digest   (or `scout serve` for the Digest page)");
      }),
    );
}
