/**
 * `scout agent run|goals|status` and `scout mcp`: the command-line side of autopilot (D-013).
 *
 * Why they exist: the model decides the job hunt; these commands start it, show what it is doing,
 * and let the owner write the goals it follows. `scout mcp` is not for people: the `claude`
 * command starts it to get Scout's tools, and it speaks the tool protocol on standard output, so
 * nothing else may print there.
 */
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  AGENT_TASKS,
  createAgentController,
  createGoalsStore,
  goalsAreStarter,
  loadLastAgentResult,
  type AgentControllerOptions,
  type AgentRunResult,
  type AgentTask,
} from "../../agent/index.js";
import { serveScoutMcp } from "../../mcp/index.js";
import { ScoutError } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";
import { withApplication } from "./with-application.js";

/** Checks the task word. Failure: `ScoutError("invalid-input")` listing the valid words. */
function parseTask(text: string): AgentTask {
  if (!(AGENT_TASKS as readonly string[]).includes(text)) {
    throw new ScoutError(
      "invalid-input",
      `"${text}" is not a kind of run. Use one of: ${AGENT_TASKS.join(", ")}.`,
    );
  }
  return text as AgentTask;
}

/** Prints a finished run in plain words. */
function printResult(result: AgentRunResult): void {
  console.log(`Run: ${result.task}, ${result.outcome}`);
  console.log(`Started: ${result.startedAt}   Finished: ${result.finishedAt}`);
  console.log(`Tool calls: ${result.toolCalls}   Turns: ${result.turns}`);
  console.log(`Summary: ${result.summary}`);
}

/**
 * Registers the commands. `agentOptions` replace the real `claude` program in tests; the real
 * program passes none.
 */
export function registerAgent(
  program: Command,
  overrides: ApplicationOptions,
  agentOptions: AgentControllerOptions = {},
): void {
  program
    .command("mcp")
    .description(
      "Serve Scout's tools to the model over standard input and output (used by `scout agent run`).",
    )
    .action(() => withApplication(overrides, (application) => serveScoutMcp(application)));

  const agent = program
    .command("agent")
    .description(
      "Autopilot: the model (Sonnet 5.5, run by `claude`) does the job hunt with Scout's tools.",
    );

  agent
    .command("run [task]")
    .description(
      `Run one pass in the foreground and print the live log (${AGENT_TASKS.join(", ")}; default hunt).`,
    )
    .option("--instruction <text>", "your own words for this run (needed for custom)")
    .option("--web", "let a custom run use web search and page fetch on known job-board hosts")
    .action((task: string | undefined, options: { instruction?: string; web?: boolean }) =>
      withApplication(overrides, async (application) => {
        const kind = parseTask(task ?? "hunt");
        if (kind === "custom" && !options.instruction?.trim()) {
          throw new ScoutError(
            "invalid-input",
            'A custom run needs your instruction: scout agent run custom --instruction "what to do".',
          );
        }
        const runner = createAgentController(application, agentOptions);
        runner.subscribe((event) =>
          console.log(`[${event.at.slice(11, 19)}] ${event.kind}: ${event.summary}`),
        );
        const stop = (): void => runner.stop();
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        try {
          runner.start(kind, options.instruction, { web: options.web === true });
          const result = await runner.done();
          if (result === undefined) return;
          console.log("");
          printResult(result);
          if (result.outcome === "failed") throw new ScoutError("unavailable", result.summary);
        } finally {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
        }
      }),
    );

  agent
    .command("goals")
    .description("Show your goals, or replace them with --edit FILE or --set TEXT.")
    .option("--edit <file>", "replace the goals with the contents of this text file")
    .option("--set <text>", "replace the goals with this text")
    .action((options: { edit?: string; set?: string }) =>
      withApplication(overrides, (application) => {
        const store = createGoalsStore(application.directory);
        if (options.edit !== undefined && options.set !== undefined) {
          throw new ScoutError("invalid-input", "Use either --edit or --set, not both.");
        }
        const replacement = options.edit !== undefined ? readGoalsFile(options.edit) : options.set;
        if (replacement !== undefined) {
          store.save(replacement);
          console.log("Goals saved.");
          return;
        }
        const text = store.load();
        console.log(text.trimEnd());
        if (goalsAreStarter(text)) {
          console.log(
            "\nThese are the starter goals. Write your own with `scout agent goals --edit FILE`.",
          );
        }
      }),
    );

  agent
    .command("status")
    .description("Show the result of the last autopilot run.")
    .action(() =>
      withApplication(overrides, (application) => {
        const result = loadLastAgentResult(application.directory);
        if (result === undefined) {
          console.log("No autopilot run yet. Start one with `scout agent run`.");
          return;
        }
        printResult(result);
      }),
    );
}

/** Reads a goals file. Failure: `ScoutError("not-found")` naming the file. */
function readGoalsFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new ScoutError("not-found", `The goals file ${path} could not be read. Check the path.`);
  }
}
