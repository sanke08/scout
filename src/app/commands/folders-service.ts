/**
 * `scout service plist [--program PATH]`: prints the macOS launchd file that would keep Scout
 * running in the background. It only prints; it never writes the file or loads it.
 *
 * Why it exists: IDEA 5.16 wants a background service, but installing one changes the user's
 * machine, so Scout shows the exact text and the steps and the user decides. The property list
 * goes to standard output alone (so `scout service plist > file.plist` is valid); the install steps
 * go to standard error.
 *
 * Example: `scout service plist --program /opt/scout/dist/index.js > com.scout.agent.plist`.
 */
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { renderLaunchAgentPlist } from "../../folders/index.js";
import type { ApplicationOptions } from "../application.js";
import { resolveDataFolder } from "./folders-directory.js";

/** The service's name in launchd. */
const SERVICE_LABEL = "com.scout.agent";

/** The command the service runs: Scout's local web page and digest. */
const SERVICE_COMMAND = "serve";

/** Registers `service plist` on the program. */
export function registerService(program: Command, overrides: ApplicationOptions): void {
  const service = program.command("service").description("Background service (macOS launchd).");

  service
    .command("plist")
    .description("Print the launchd property list and the manual install steps. Writes nothing.")
    .option("--program <path>", "the Scout program file to run (default: the one running now)")
    .action((options: { program?: string }) => {
      const scriptPath = resolve(options.program ?? process.argv[1] ?? "scout");
      const dataFolder = resolveDataFolder(overrides);
      const logFolder = join(dataFolder, "logs");
      const plist = renderLaunchAgentPlist({
        label: SERVICE_LABEL,
        programArguments: [process.execPath, scriptPath, SERVICE_COMMAND],
        workingDirectory: process.cwd(),
        logDirectory: logFolder,
      });
      console.log(plist);
      const target = `~/Library/LaunchAgents/${SERVICE_LABEL}.plist`;
      console.error(
        [
          "Nothing was installed. To install it yourself, after checking the text above:",
          `  1. Save the text as ${target} (for example: scout service plist > ${target}).`,
          `  2. Create the log folder: mkdir -p ${logFolder}`,
          `  3. Start it: launchctl bootstrap gui/$(id -u) ${target}`,
          `  To stop it: launchctl bootout gui/$(id -u) ${target}`,
          `  If you set SCOUT_DATA_DIR, the service needs it too: it runs in ${process.cwd()} and looks for ./data there.`,
        ].join("\n"),
      );
    });
}
