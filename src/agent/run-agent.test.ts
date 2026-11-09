/** Tests for the autopilot runner with a fake `claude`: it never starts a real program. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApplication, type TestApplication } from "../app/test-helpers.js";
import { MODEL_NAME } from "../brain/engines.js";
import {
  assistantText,
  assistantToolUse,
  fakeClaude,
  successResult,
  toolResultLine,
} from "./fake-claude.js";
import { createGoalsStore } from "./goals-store.js";
import { RUNS_FOLDER_NAME, createAgentController, type AgentRunner } from "./run-agent.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** An application with real goals written, so a run may start. */
function setup(): TestApplication {
  const test = makeTestApplication([], {});
  cleanups.push(test.cleanUp);
  createGoalsStore(test.directory).save("Backend roles, remote.");
  return test;
}

const MCP = { command: "node", args: ["scout.js", "mcp"] };

describe("createAgentController", () => {
  it("runs a task to the end, counts calls and turns, and keeps a readable log", async () => {
    const test = setup();
    const fake = fakeClaude({
      lines: [
        assistantText("Reading the profile."),
        assistantToolUse("get_profile"),
        toolResultLine('{"name":"Alex"}'),
        successResult("Shortlisted two jobs.", 4),
      ],
    });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
    });
    runner.start("hunt", "be quick");
    expect(runner.state().running).toBe(true);
    const result = await runner.done();
    expect(result).toMatchObject({
      task: "hunt",
      outcome: "done",
      summary: "Shortlisted two jobs.",
      toolCalls: 1,
      turns: 4,
    });
    const state = runner.state();
    expect(state.running).toBe(false);
    expect(state.last).toEqual(result);
    expect(state.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["system", "text", "tool", "result"]),
    );
    expect(fake.requests[0]?.input).toContain("be quick");
  });

  it("always asks for Sonnet 5.5 with only Scout's tools and the configured turn limit", async () => {
    const test = setup();
    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      agentMaxTurns: 17,
    });
    const fake = fakeClaude({ lines: [successResult("ok")] });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
    });
    runner.start("inbox");
    await runner.done();
    const args = fake.requests[0]?.args ?? [];
    const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(fake.requests[0]?.command).toBe("claude");
    expect(after("--model")).toBe(MODEL_NAME);
    expect(after("--max-turns")).toBe("17");
    expect(args).toContain("--strict-mcp-config");
    expect(after("--allowedTools")).toContain("mcp__scout__*");
    expect(after("--system-prompt")).toContain("Backend roles, remote.");
    expect(args).not.toContain("codex");
  });

  it("writes an MCP config with the data folder and no secrets, and the raw events to a log file", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [assistantToolUse("get_profile"), successResult("ok")] });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
    });
    runner.start("hunt");
    await runner.done();
    const files = readdirSync(join(test.directory, RUNS_FOLDER_NAME));
    const config = files.find((name) => name.endsWith(".mcp.json"));
    const log = files.find((name) => name.endsWith(".jsonl"));
    expect(config).toBeDefined();
    expect(log).toBeDefined();
    const parsed = JSON.parse(
      readFileSync(join(test.directory, RUNS_FOLDER_NAME, config!), "utf8"),
    );
    expect(parsed.mcpServers.scout).toEqual({
      command: "node",
      args: ["scout.js", "mcp"],
      env: { SCOUT_DATA_DIR: test.directory },
    });
    const lines = readFileSync(join(test.directory, RUNS_FOLDER_NAME, log!), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });

  it("refuses to start while paused, while running, and while goals are the starter text", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [], hang: true });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
    });
    runner.start("hunt");
    expect(() => runner.start("inbox")).toThrowError(/already going/);
    runner.stop();
    await runner.done();

    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      automationPaused: true,
    });
    expect(() => runner.start("hunt")).toThrowError(/paused/i);

    const fresh = makeTestApplication([], {});
    cleanups.push(fresh.cleanUp);
    const unwritten = createAgentController(fresh.application, { spawner: fake.spawner });
    expect(() => unwritten.start("hunt")).toThrowError(/goals first/i);
    expect(unwritten.state().running).toBe(false);
  });

  it("kills the command within a poll when the pause switch turns on", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [assistantToolUse("get_profile")], hang: true });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
    });
    runner.start("hunt");
    await new Promise((resolve) => setTimeout(resolve, 30));
    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      automationPaused: true,
    });
    const result = await runner.done();
    expect(fake.kills).toBe(1);
    expect(result?.outcome).toBe("stopped");
    expect(result?.summary).toMatch(/paused/i);
  });

  it("stops on request, and stop is safe when nothing runs", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [], hang: true });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
    });
    runner.stop();
    runner.start("hunt");
    runner.stop();
    runner.stop();
    const result = await runner.done();
    expect(result?.outcome).toBe("stopped");
    expect(fake.kills).toBe(1);
    expect(runner.state().running).toBe(false);
  });

  it("stops a run that goes over the time limit and reports it as failed", async () => {
    const test = setup();
    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      agentMaxMinutes: 1,
    });
    let clock = 0;
    const fake = fakeClaude({ lines: [], hang: true });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
      wallClock: () => clock,
    });
    runner.start("hunt");
    clock = 61_000;
    const result = await runner.done();
    expect(result?.outcome).toBe("failed");
    expect(result?.summary).toMatch(/1 minute/);
    expect(fake.kills).toBe(1);
  });

  it("reports a command that could not start as a failed result, never a crash", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [], cannotStart: 'The "claude" command was not found.' });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
    });
    runner.start("hunt");
    const result = await runner.done();
    expect(result).toMatchObject({ outcome: "failed" });
    expect(result?.summary).toContain("not found");
  });

  it("reports a spawner that throws, a non-zero exit and a model that ran out of turns as failed", async () => {
    const test = setup();
    const throwing = createAgentController(test.application, {
      spawner: () => {
        throw new Error("spawn exploded");
      },
      mcpLaunch: MCP,
    });
    throwing.start("hunt");
    expect((await throwing.done())?.summary).toContain("spawn exploded");

    const crashed = createAgentController(test.application, {
      spawner: fakeClaude({
        lines: [],
        exit: { exitCode: 1, errorText: "Not logged in" },
      }).spawner,
      mcpLaunch: MCP,
    });
    crashed.start("hunt");
    expect((await crashed.done())?.outcome).toBe("failed");

    const outOfTurns = createAgentController(test.application, {
      spawner: fakeClaude({
        lines: [JSON.stringify({ type: "result", subtype: "error_max_turns", num_turns: 60 })],
      }).spawner,
      mcpLaunch: MCP,
    });
    outOfTurns.start("hunt");
    const result = await outOfTurns.done();
    expect(result?.outcome).toBe("failed");
    expect(result?.summary).toMatch(/turns/);
  });

  it("keeps at most 200 events and remembers the last result for other processes", async () => {
    const test = setup();
    const lines = Array.from({ length: 300 }, (_, index) => assistantText(`step ${index}`));
    const fake = fakeClaude({ lines: [...lines, successResult("ok")] });
    const runner: AgentRunner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
    });
    runner.start("hunt");
    const result = await runner.done();
    expect(runner.state().events.length).toBeLessThanOrEqual(200);
    expect(existsSync(join(test.directory, RUNS_FOLDER_NAME, "last-result.json"))).toBe(true);
    const reopened = createAgentController(test.application, { spawner: fake.spawner });
    expect(reopened.state().last).toEqual(result);
  });
});
