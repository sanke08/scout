/**
 * Tests for the MCP server: in memory with test tools (every behaviour), and as a real child
 * process (`scout mcp` over standard input and output) against a temporary data folder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { makeTestApplication, type TestApplication } from "../app/test-helpers.js";
import { createScoutMcpServer, createScoutMcpService } from "./server.js";
import { fail, ok, type ScoutTool } from "./tool.js";
import { ALL_TOOLS } from "./tools/index.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/** Tools used only by these tests. */
const TEST_TOOLS: ScoutTool[] = [
  {
    name: "echo",
    description: "Returns what it was given.",
    inputSchema: z.object({ word: z.string() }),
    readOnly: true,
    handler: (input: { word: string }, context) => {
      context.note(`echo ${input.word}`);
      return ok({ word: input.word });
    },
  },
  {
    name: "act",
    description: "Pretends to act; refuses when paused.",
    inputSchema: z.object({}),
    readOnly: false,
    handler: (_input, context) => {
      context.assertNotPaused();
      return ok({ acted: true });
    },
  },
  {
    name: "refuse",
    description: "Always fails with a sentence.",
    inputSchema: z.object({}),
    readOnly: true,
    handler: () => fail("Nothing here."),
  },
  {
    name: "explode",
    description: "Throws.",
    inputSchema: z.object({}),
    readOnly: true,
    handler: () => {
      throw new Error("handler blew up");
    },
  },
];

/** A client connected in memory to a server with the test tools over a fresh application. */
async function connect(): Promise<{ client: Client; test: TestApplication }> {
  const test = makeTestApplication([], {});
  const server = createScoutMcpServer(test.application, TEST_TOOLS);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  cleanups.push(async () => {
    await client.close();
    test.cleanUp();
  });
  return { client, test };
}

/** The text of the first block of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content: { text: string }[] }).content;
  return content[0]?.text ?? "";
}

describe("createScoutMcpServer", () => {
  it("lists every registered tool with its description", async () => {
    const { client } = await connect();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      TEST_TOOLS.map((tool) => tool.name).sort(),
    );
    expect(listed.tools.find((tool) => tool.name === "echo")?.description).toContain("Returns");
  });

  it("returns JSON text for a success and notes the call in the action log", async () => {
    const { client, test } = await connect();
    const result = await client.callTool({ name: "echo", arguments: { word: "hi" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({ word: "hi" });
    const notes = test.application.actionLog.recent(10).map((entry) => entry.detail);
    expect(notes.join(" ")).toContain("echo hi");
  });

  it("flags a failure result as an error and turns a thrown error into an error result", async () => {
    const { client } = await connect();
    const refused = await client.callTool({ name: "refuse", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("Nothing here.");
    const exploded = await client.callTool({ name: "explode", arguments: {} });
    expect(exploded.isError).toBe(true);
    expect(textOf(exploded)).toContain("handler blew up");
    const after = await client.callTool({ name: "echo", arguments: { word: "still alive" } });
    expect(after.isError).toBeFalsy();
  });

  it("answers a paused Scout with an error result and does nothing", async () => {
    const { client, test } = await connect();
    expect((await client.callTool({ name: "act", arguments: {} })).isError).toBeFalsy();
    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      automationPaused: true,
    });
    const paused = await client.callTool({ name: "act", arguments: {} });
    expect(paused.isError).toBe(true);
    expect(textOf(paused)).toMatch(/paused/i);
  });

  it("refuses invalid input and an unknown tool without running a handler", async () => {
    const { client } = await connect();
    const invalid = await client
      .callTool({ name: "echo", arguments: { word: 42 } })
      .catch((error: unknown) => ({ isError: true, error }));
    expect(invalid.isError).toBe(true);
    const unknown = await client
      .callTool({ name: "no_such_tool", arguments: {} })
      .catch((error: unknown) => ({ isError: true, error }));
    expect(unknown.isError).toBe(true);
  });
});

describe("graceful stop", () => {
  /** Connects a client to a service whose only tool waits for `release`. */
  async function connectSlow(): Promise<{
    client: Client;
    service: ReturnType<typeof createScoutMcpService>;
    release: () => void;
    log: string[];
    started: Promise<void>;
  }> {
    const test = makeTestApplication([], {});
    const log: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let begin: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const slow: ScoutTool = {
      name: "slow",
      description: "Waits, then reads the database.",
      inputSchema: z.object({}),
      readOnly: false,
      handler: async (_input, context) => {
        begin();
        await gate;
        log.push(`handler read ${context.application.jobStore.list().length} jobs`);
        return ok({ done: true });
      },
    };
    const service = createScoutMcpService(test.application, [slow], { drainMilliseconds: 40 });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await service.server.connect(serverSide);
    await client.connect(clientSide);
    cleanups.push(async () => {
      await client.close();
      test.cleanUp();
    });
    return { client, service, release, log, started };
  }

  it("waits for a running call before reporting that it has stopped, and refuses new calls meanwhile", async () => {
    const { client, service, release, log, started } = await connectSlow();
    const running = client.callTool({ name: "slow", arguments: {} });
    await started;
    const order: string[] = [];
    const stopped = service.shutdown().then((drained) => {
      order.push("stopped");
      return drained;
    });
    expect(service.isStopping()).toBe(true);
    const refused = await client.callTool({ name: "slow", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/stopping/);
    expect(order).toEqual([]);
    release();
    const result = await running;
    expect(await stopped).toBe(true);
    expect(log).toEqual(["handler read 0 jobs"]);
    expect(result.isError).toBeFalsy();
  });

  it("stops at once when nothing is running, and gives up after the bound when something is", async () => {
    const idle = await connectSlow();
    expect(await idle.service.shutdown()).toBe(true);

    const stuck = await connectSlow();
    void stuck.client.callTool({ name: "slow", arguments: {} });
    await stuck.started;
    expect(await stuck.service.shutdown()).toBe(false);
    stuck.release();
  });
});

describe("scout mcp as a child process", () => {
  it("serves the real tool list over standard input and output with a clean protocol channel", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-mcp-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/index.ts"), "mcp"],
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        SCOUT_DATA_DIR: directory,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    cleanups.push(() => client.close());
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      ALL_TOOLS.map((tool) => tool.name).sort(),
    );
  }, 30_000);
});
