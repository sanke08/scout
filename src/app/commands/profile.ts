/**
 * `scout profile show` and `scout profile validate`: look at the profile and check it is ready.
 *
 * Why they exist: the profile is the one source of truth and Scout refuses to run on an
 * incomplete one, so the user needs a fast way to see what Scout sees and what is missing.
 */
import type { Command } from "commander";
import { missingRequiredFields } from "../../profile/index.js";
import { ScoutError, type Profile } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** Counts the points of a profile by status, e.g. `{ confirmed: 12, hold: 1 }`. */
function countPointsByStatus(profile: Profile): Record<string, number> {
  const counts: Record<string, number> = {};
  const entries = [...profile.experience, ...profile.projects];
  for (const entry of entries) {
    for (const point of entry.points) {
      counts[point.status] = (counts[point.status] ?? 0) + 1;
    }
  }
  return counts;
}

/** Registers `profile show` and `profile validate`. */
export function registerProfile(program: Command, overrides: ApplicationOptions): void {
  const profileCommand = program.command("profile").description("Look at and check your profile.");

  profileCommand
    .command("show")
    .description("Print a short summary of your profile.")
    .action(() =>
      withApplication(overrides, (application) => {
        const profile = application.profileStore.load();
        console.log(
          `${profile.identity.name}, ${profile.identity.location} (profile version ${profile.version})`,
        );
        console.log(`Target roles: ${profile.preferences.targetRoles.join(", ") || "none"}`);
        console.log(`Locations: ${profile.preferences.locations.join(", ") || "none"}`);
        console.log(`Seniority accepted: ${profile.preferences.seniority.join(", ") || "none"}`);
        for (const row of profile.skills) {
          console.log(`${row.label}: ${row.items.join(", ")}`);
        }
        console.log(
          `Experience entries: ${profile.experience.length}, projects: ${profile.projects.length}`,
        );
        const counts = Object.entries(countPointsByStatus(profile))
          .map(([status, count]) => `${count} ${status}`)
          .join(", ");
        console.log(`Points: ${counts || "none"}`);
      }),
    );

  profileCommand
    .command("validate")
    .description("Check the profile file is valid and has everything Scout needs to run.")
    .action(() =>
      withApplication(overrides, (application) => {
        const profile = application.profileStore.load();
        const missing = missingRequiredFields(profile);
        if (missing.length > 0) {
          const lines = missing.map((field) => `  - ${field.path}: ${field.question}`);
          throw new ScoutError(
            "invalid-input",
            `The profile file is valid but not complete. Fill in:\n${lines.join("\n")}`,
          );
        }
        console.log(`The profile is valid and complete (version ${profile.version}).`);
      }),
    );
}
