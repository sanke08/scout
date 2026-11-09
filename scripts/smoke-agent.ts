/**
 * Live smoke check for autopilot: starts the real `claude` command (Sonnet 5.5) with Scout's real
 * tools over a temporary data folder, gives it one tiny read-only job (list the goals, list the
 * boards, stop) limited to six turns, and prints the event log. It needs the `claude` command
 * signed in, and it uses a little of the owner's Claude usage, so it is not part of `npm test`.
 *
 * Run: `npm run smoke:agent`. A line that says FAIL means the run did not end as `done`.
 * Everything in the temporary folder is fictional (the sample profile, an invented board).
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentController, createGoalsStore } from "../src/agent/index.js";
import { createApplication } from "../src/app/index.js";

/** The most turns the smoke run may use. */
const SMOKE_MAX_TURNS = 6;

/** The goals written into the temporary folder. */
const SMOKE_GOALS = "Backend or platform roles in Berlin or remote in Europe. Avoid gambling.";

/** The tiny job given to the model. */
const SMOKE_INSTRUCTION =
  "This is a smoke test. Do exactly this and nothing else: call the tool that returns my goals, call the tool that lists my watched boards, then stop and summarise in one sentence what you saw. Do not fetch any board, do not search the web and do not change anything.";

/** Runs the smoke check and prints the log. */
async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "scout-smoke-agent-"));
  const application = createApplication({ directory });
  try {
    copyFileSync(resolve("fixtures/profile.sample.json"), join(directory, "profile.json"));
    createGoalsStore(directory).save(SMOKE_GOALS);
    application.boardStore.add({ kind: "greenhouse", token: "smoke-fixture-board" });

    const runner = createAgentController(application, {
      maxTurns: SMOKE_MAX_TURNS,
      allowWeb: false,
      mcpLaunch: {
        command: process.execPath,
        args: [...process.execArgv, resolve("src/index.ts"), "mcp"],
      },
    });
    runner.subscribe((event) => console.log(`[${event.kind}] ${event.summary}`));
    runner.start("custom", SMOKE_INSTRUCTION);
    const result = await runner.done();
    console.log("");
    console.log(JSON.stringify(result, null, 2));
    if (result?.outcome !== "done") {
      console.log("FAIL: the run did not finish as done.");
      process.exitCode = 1;
    }
  } finally {
    application.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
