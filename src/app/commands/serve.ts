/**
 * `scout serve [--port N]` starts the local web page; `scout pause` and `scout unpause` flip the
 * kill switch.
 *
 * Why they exist: the page is the Digest, Profile and Settings of the product, and the kill switch
 * must be one command away (idea document 5.10). The server listens on 127.0.0.1 only and stops on
 * Ctrl-C.
 */
import type { Command } from "commander";
import { ScoutError } from "../../shared/index.js";
import { startWebServer } from "../../web/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { createWebDependencies } from "../web-dependencies.js";
import { withApplication } from "./with-application.js";

/** The port used when none is given. */
export const DEFAULT_PORT = 4173;

/** Reads `--port`, accepting 0 (any free port) to 65535. */
function parsePort(text: string | undefined): number {
  if (text === undefined) return DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ScoutError(
      "invalid-input",
      `The port must be a whole number from 0 to 65535, but it was "${text}".`,
    );
  }
  return port;
}

/** Resolves when the process receives Ctrl-C (SIGINT) or SIGTERM. */
function waitForStopSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

/** Registers `serve`, `pause` and `unpause`. */
export function registerServe(program: Command, overrides: ApplicationOptions): void {
  program
    .command("serve")
    .description("Start the local web page (Digest, Profile, Settings) on 127.0.0.1.")
    .option("--port <number>", `port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)`)
    .action((options: { port?: string }) =>
      withApplication(overrides, async (application) => {
        const port = parsePort(options.port);
        const server = await startWebServer(
          createWebDependencies(application, {
            ...(overrides.platforms === undefined ? {} : { platforms: overrides.platforms }),
          }),
          { port },
        );
        console.log(`Scout is running at ${server.url}`);
        console.log("Press Ctrl-C to stop.");
        await waitForStopSignal();
        await server.close();
        console.log("Scout stopped.");
      }),
    );

  program
    .command("pause")
    .description(
      "Kill switch on: Scout will not fill forms or submit. Finding and scoring continue.",
    )
    .action(() => withApplication(overrides, (application) => setPaused(application, true)));

  program
    .command("unpause")
    .description("Kill switch off.")
    .action(() => withApplication(overrides, (application) => setPaused(application, false)));
}

/** Saves the kill-switch setting, logs the change and tells the user. */
function setPaused(application: Application, paused: boolean): void {
  const settings = application.settingsStore.load();
  application.settingsStore.save({ ...settings, automationPaused: paused });
  application.actionLog.append({
    actor: "app",
    action: paused ? "pause" : "unpause",
    detail: paused
      ? "Automation paused from the command line."
      : "Automation resumed from the command line.",
  });
  console.log(
    paused
      ? "Automation is paused. Scout will not fill forms or submit until you run `scout unpause`. Finding and scoring continue."
      : "Automation is no longer paused.",
  );
}
