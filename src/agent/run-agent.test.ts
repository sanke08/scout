/** Tests for the autopilot runner with a fake `claude`: it never starts a real program. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** The value after a flag in the arguments given to the fake `claude`. */
function after(args: readonly string[], flag: string): string | undefined {
  return args[args.indexOf(flag) + 1];
}

/** Runs one task to the end with a fake `claude` and returns what it was asked to start. */
async function runTask(
  test: TestApplication,
  task: "hunt" | "inbox" | "followups" | "custom",
  start: { instruction?: string; web?: boolean } = {},
): Promise<readonly string[]> {
  const fake = fakeClaude({ lines: [successResult("ok")] });
  const runner = createAgentController(test.application, {
    spawner: fake.spawner,
    mcpLaunch: MCP,
    environment: {},
  });
  runner.start(task, start.instruction, start.web === undefined ? undefined : { web: start.web });
  await runner.done();
  return fake.requests[0]?.args ?? [];
}

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
    expect(fake.requests[0]?.command).toBe("claude");
    expect(after(args, "--model")).toBe(MODEL_NAME);
    expect(after(args, "--max-turns")).toBe("17");
    expect(args).toContain("--strict-mcp-config");
    expect(after(args, "--allowedTools")).toContain("mcp__scout__*");
    expect(after(args, "--system-prompt")).toContain("Backend roles, remote.");
    expect(args).not.toContain("codex");
  });

  it("writes an MCP config with the data folder and no secrets, and the event summaries to a log file", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [assistantToolUse("get_profile"), successResult("ok")] });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      environment: {},
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

describe("web access per task", () => {
  it("gives inbox and followups no web tool at all, even with feeds and boards listed", async () => {
    const test = setup();
    test.application.boardStore.add({ kind: "greenhouse", token: "examplecorp" });
    for (const task of ["inbox", "followups"] as const) {
      const args = await runTask(test, task);
      expect(after(args, "--allowedTools")).toBe("mcp__scout__*");
      expect(after(args, "--tools")).toBe("");
    }
  });

  it("gives hunt web search and page fetch limited to the hosts of the watched boards", async () => {
    const test = setup();
    test.application.boardStore.add({ kind: "lever", token: "examplecorp" });
    test.application.boardStore.add({ kind: "feed", token: "https://jobs.example.com/rss?x=1" });
    const args = await runTask(test, "hunt");
    const allowed = (after(args, "--allowedTools") ?? "").split(",");
    expect(allowed).toEqual(
      expect.arrayContaining([
        "WebSearch",
        "WebFetch(domain:jobs.lever.co)",
        "WebFetch(domain:jobs.example.com)",
      ]),
    );
    expect(allowed).not.toContain("WebFetch");
    expect(after(args, "--tools")).toBe("WebSearch,WebFetch");
  });

  it("offers custom the web only when the owner asked for it", async () => {
    const test = setup();
    const off = await runTask(test, "custom", { instruction: "Tidy my list" });
    expect(after(off, "--allowedTools")).toBe("mcp__scout__*");
    const on = await runTask(test, "custom", { instruction: "Search for Rust jobs", web: true });
    expect(after(on, "--allowedTools")).toContain("WebSearch");
  });

  it("turns the web off for every task with the master switch", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [successResult("ok")] });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      allowWeb: false,
      environment: {},
    });
    runner.start("hunt");
    await runner.done();
    expect(after(fake.requests[0]?.args ?? [], "--allowedTools")).toBe("mcp__scout__*");
  });
});

describe("the MCP config and the run log", () => {
  it("names the mail variables that are set and never writes a secret value", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [successResult("ok")] });
    const secret = "hunter2-very-secret";
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      environment: {
        SCOUT_IMAP_HOST: "imap.example.com",
        SCOUT_IMAP_USER: "alex@example.com",
        SCOUT_IMAP_PASSWORD: secret,
      },
    });
    runner.start("inbox");
    await runner.done();
    const folder = join(test.directory, RUNS_FOLDER_NAME);
    const name = readdirSync(folder).find((file) => file.endsWith(".mcp.json"))!;
    const text = readFileSync(join(folder, name), "utf8");
    expect(JSON.parse(text).mcpServers.scout.env).toEqual({
      SCOUT_DATA_DIR: test.directory,
      SCOUT_IMAP_HOST: "${SCOUT_IMAP_HOST}",
      SCOUT_IMAP_USER: "${SCOUT_IMAP_USER}",
      SCOUT_IMAP_PASSWORD: "${SCOUT_IMAP_PASSWORD}",
    });
    for (const value of [secret, "imap.example.com", "alex@example.com"]) {
      expect(text).not.toContain(value);
    }
  });

  it("references only the mail variables that are set", async () => {
    const test = setup();
    const fake = fakeClaude({ lines: [successResult("ok")] });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      environment: { SCOUT_IMAP_HOST: "imap.example.com", SCOUT_IMAP_USER: "" },
    });
    runner.start("inbox");
    await runner.done();
    const folder = join(test.directory, RUNS_FOLDER_NAME);
    const name = readdirSync(folder).find((file) => file.endsWith(".mcp.json"))!;
    expect(
      Object.keys(JSON.parse(readFileSync(join(folder, name), "utf8")).mcpServers.scout.env),
    ).toEqual(["SCOUT_DATA_DIR", "SCOUT_IMAP_HOST"]);
  });

  it("logs summaries only: no tool answer text, no full input, and every line is capped", async () => {
    const test = setup();
    const profileText = "PROFILE-SECRET-NAME Alex Example 12 Hill Street";
    const longInput = "z".repeat(5000);
    const fake = fakeClaude({
      lines: [
        assistantText("a".repeat(5000)),
        assistantToolUse("record_decision", { jobId: "j1", reason: longInput }),
        toolResultLine(profileText),
        toolResultLine("form field says " + profileText, true),
        successResult("Done."),
      ],
    });
    const runner = createAgentController(test.application, {
      spawner: fake.spawner,
      mcpLaunch: MCP,
      environment: {},
    });
    runner.start("hunt");
    await runner.done();
    const folder = join(test.directory, RUNS_FOLDER_NAME);
    const log = readFileSync(
      join(
        folder,
        readdirSync(folder).find((f) => f.endsWith(".jsonl"))!,
      ),
      "utf8",
    );
    expect(log).not.toContain("PROFILE-SECRET-NAME");
    expect(log).not.toContain("12 Hill Street");
    expect(log).not.toContain("z".repeat(100));
    for (const line of log.trim().split("\n")) expect(line.length).toBeLessThanOrEqual(400);
    expect(log).toContain("record_decision");
  });

  it("keeps only the newest 30 runs, and keeps the last result", async () => {
    const test = setup();
    const folder = join(test.directory, RUNS_FOLDER_NAME);
    mkdirSync(folder, { recursive: true });
    for (let day = 1; day <= 40; day += 1) {
      const stamp = `2026-01-${String(day).padStart(2, "0")}T10-00-00-hunt`;
      writeFileSync(join(folder, `${stamp}.jsonl`), "{}\n");
      writeFileSync(join(folder, `${stamp}.mcp.json`), "{}");
    }
    writeFileSync(join(folder, "last-result.json"), "{}");
    await runTask(test, "hunt");
    const runs = readdirSync(folder).filter((name) => name.endsWith(".jsonl"));
    expect(runs).toHaveLength(30);
    expect(runs).toContain("2026-01-40T10-00-00-hunt.jsonl");
    expect(runs).not.toContain("2026-01-01T10-00-00-hunt.jsonl");
    expect(readdirSync(folder).filter((name) => name.endsWith(".mcp.json"))).toHaveLength(30);
    expect(existsSync(join(folder, "last-result.json"))).toBe(true);
  });
});

describe("one run across controllers", () => {
  it("refuses a second controller on the same folder, then allows it after the first ends", async () => {
    const test = setup();
    const hanging = fakeClaude({ lines: [], hang: true });
    const first = createAgentController(test.application, {
      spawner: hanging.spawner,
      mcpLaunch: MCP,
      pollMilliseconds: 10,
      environment: {},
    });
    const second = createAgentController(test.application, {
      spawner: fakeClaude({ lines: [successResult("ok")] }).spawner,
      mcpLaunch: MCP,
      environment: {},
    });
    first.start("hunt");
    expect(existsSync(join(test.directory, RUNS_FOLDER_NAME, "run.lock"))).toBe(true);
    expect(() => second.start("inbox")).toThrowError(/already going/);
    expect(second.state().running).toBe(false);
    first.stop();
    await first.done();
    expect(existsSync(join(test.directory, RUNS_FOLDER_NAME, "run.lock"))).toBe(false);
    second.start("inbox");
    expect((await second.done())?.outcome).toBe("done");
  });

  it("takes over a stale lock whose process is gone, and replaces a damaged one", async () => {
    const test = setup();
    const folder = join(test.directory, RUNS_FOLDER_NAME);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "run.lock"),
      JSON.stringify({ pid: 2_147_483_000, startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    await runTask(test, "hunt");
    expect(existsSync(join(folder, "run.lock"))).toBe(false);
    writeFileSync(join(folder, "run.lock"), "not json");
    await runTask(test, "hunt");
    expect(existsSync(join(folder, "run.lock"))).toBe(false);
  });

  it("releases the lock when the run fails", async () => {
    const test = setup();
    const runner = createAgentController(test.application, {
      spawner: () => {
        throw new Error("spawn exploded");
      },
      mcpLaunch: MCP,
      environment: {},
    });
    runner.start("hunt");
    await runner.done();
    expect(existsSync(join(test.directory, RUNS_FOLDER_NAME, "run.lock"))).toBe(false);
  });
});
