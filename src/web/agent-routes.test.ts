/**
 * Tests of the autopilot routes over real HTTP with a fake controller and the real goals store.
 * Properties that must stay true: without a controller the routes say autopilot is not enabled; a
 * second start while a run goes, a start while paused and a start with the starter goals are all
 * refused with the sentence the controller gave and start nothing; stopping is always safe; pausing
 * automation in Settings stops a run; the goals text round-trips and is length-capped; a request
 * from another site changes nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAXIMUM_GOALS_CHARACTERS,
  STARTER_GOALS,
  createGoalsStore,
  type AgentController,
  type AgentState,
  type AgentTask,
} from "../agent/index.js";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  type JobStore,
  type Settings,
  type SettingsStore,
} from "../shared/index.js";
import { startWebServer, type RunningWebServer, type WebDependencies } from "./index.js";

/** Settings kept in memory. */
class FakeSettingsStore implements SettingsStore {
  settings: Settings = { ...DEFAULT_SETTINGS };
  load(): Settings {
    return { ...this.settings };
  }
  save(settings: Settings): Settings {
    this.settings = { ...settings };
    return { ...settings };
  }
}

/** A controller that records calls and follows the rules the real one keeps. */
class FakeAgent implements AgentController {
  started: { task: AgentTask; instruction?: string | undefined }[] = [];
  stops = 0;
  paused = false;
  goalsWritten = true;
  current: AgentState = { running: false, events: [] };
  start(task: AgentTask, instruction?: string): void {
    if (this.paused) throw new ScoutError("paused", "Automation is paused. Resume it first.");
    if (!this.goalsWritten) {
      throw new ScoutError(
        "invalid-input",
        "Write your goals first. They are still the starter text.",
      );
    }
    this.started.push({ task, instruction });
    this.current = {
      running: true,
      task,
      startedAt: "2026-11-09T09:00:00.000Z",
      events: [{ at: "2026-11-09T09:00:00.000Z", kind: "system", summary: "Started." }],
    };
  }
  stop(): void {
    this.stops += 1;
    this.current = { ...this.current, running: false };
  }
  state(): AgentState {
    return this.current;
  }
}

/** The reply of one request. */
interface Reply {
  status: number;
  body: Record<string, unknown>;
}

let server: RunningWebServer | undefined;
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "scout-agent-routes-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(folder, { recursive: true, force: true });
});

/** Starts a server with the given extras. */
async function start(extra: Partial<WebDependencies>, settingsStore = new FakeSettingsStore()) {
  server = await startWebServer(
    {
      profileStore: {} as never,
      resumeBuilder: {} as never,
      digestProvider: () => [],
      settingsStore,
      jobStore: { list: () => [], get: () => undefined } as unknown as JobStore,
      ...extra,
    },
    { port: 0 },
  );
  return settingsStore;
}

/** Sends a request from the page's own origin unless `origin` says otherwise. */
function send(method: string, path: string, body?: unknown, origin?: string): Promise<Reply> {
  const url = new URL(server!.url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: Number(url.port),
        method,
        path,
        headers: { "Content-Type": "application/json", Origin: origin ?? server!.url },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
          }),
        );
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

describe("without autopilot", () => {
  it("answers every autopilot route with 404 and a plain sentence", async () => {
    await start({});
    for (const [method, path] of [
      ["GET", "/api/agent"],
      ["POST", "/api/agent/start"],
      ["POST", "/api/agent/stop"],
      ["GET", "/api/goals"],
      ["PUT", "/api/goals"],
    ] as const) {
      const reply = await send(
        method,
        path,
        method === "GET" ? undefined : { task: "hunt", text: "x" },
      );
      expect(reply.status).toBe(404);
      expect(reply.body["error"]).toBe("Autopilot is not enabled.");
    }
  });
});

describe("start, state and stop", () => {
  it("starts a run with 202 and passes the task and the note on", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    const reply = await send("POST", "/api/agent/start", {
      task: "custom",
      instruction: "  Only remote roles today.  ",
    });
    expect(reply.status).toBe(202);
    expect(reply.body["running"]).toBe(true);
    expect(agent.started).toEqual([{ task: "custom", instruction: "Only remote roles today." }]);
    expect((await send("GET", "/api/agent")).body["running"]).toBe(true);
  });

  it("refuses a second start while a run goes and starts nothing", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    await send("POST", "/api/agent/start", { task: "hunt" });
    const second = await send("POST", "/api/agent/start", { task: "inbox" });
    expect(second.status).toBe(409);
    expect(String(second.body["error"])).toContain("already running");
    expect(agent.started).toHaveLength(1);
  });

  it("refuses to start while paused (409) and with starter goals (400), using the controller's sentence", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    agent.paused = true;
    const paused = await send("POST", "/api/agent/start", { task: "hunt" });
    expect(paused.status).toBe(409);
    expect(paused.body["error"]).toBe("Automation is paused. Resume it first.");
    agent.paused = false;
    agent.goalsWritten = false;
    const starter = await send("POST", "/api/agent/start", { task: "hunt" });
    expect(starter.status).toBe(400);
    expect(String(starter.body["error"])).toContain("goals");
    expect(agent.started).toEqual([]);
  });

  it("refuses an unknown task or extra fields before anything starts", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    expect((await send("POST", "/api/agent/start", { task: "apply-everywhere" })).status).toBe(400);
    expect((await send("POST", "/api/agent/start", { task: "hunt", extra: 1 })).status).toBe(400);
    expect((await send("POST", "/api/agent/start", {})).status).toBe(400);
    expect(agent.started).toEqual([]);
  });

  it("stops a run, and stopping when nothing runs is safe", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    await send("POST", "/api/agent/start", { task: "hunt" });
    const stopped = await send("POST", "/api/agent/stop");
    expect(stopped.status).toBe(200);
    expect(stopped.body["running"]).toBe(false);
    expect((await send("POST", "/api/agent/stop")).status).toBe(200);
  });

  it("refuses a request from another site and starts nothing", async () => {
    const agent = new FakeAgent();
    await start({ agent });
    const reply = await send("POST", "/api/agent/start", { task: "hunt" }, "http://evil.example");
    expect(reply.status).toBe(403);
    expect((await send("POST", "/api/agent/stop", undefined, "http://evil.example")).status).toBe(
      403,
    );
    expect(agent.started).toEqual([]);
    expect(agent.stops).toBe(0);
  });
});

describe("pausing automation", () => {
  it("stops a running autopilot when Settings are saved paused, and not otherwise", async () => {
    const agent = new FakeAgent();
    const settings = await start({ agent });
    await send("POST", "/api/agent/start", { task: "hunt" });
    expect(
      (await send("PUT", "/api/settings", { ...DEFAULT_SETTINGS, dryRunFirst: false })).status,
    ).toBe(200);
    expect(agent.stops).toBe(0);
    const paused = await send("PUT", "/api/settings", {
      ...DEFAULT_SETTINGS,
      automationPaused: true,
    });
    expect(paused.status).toBe(200);
    expect(settings.settings.automationPaused).toBe(true);
    expect(agent.stops).toBe(1);
    expect(agent.state().running).toBe(false);
  });

  it("still saves settings when the server has no autopilot", async () => {
    await start({});
    const reply = await send("PUT", "/api/settings", {
      ...DEFAULT_SETTINGS,
      automationPaused: true,
    });
    expect(reply.status).toBe(200);
  });
});

describe("goals", () => {
  it("shows the starter text as not written, then saves and returns the owner's own words", async () => {
    await start({ goals: createGoalsStore(folder) });
    const first = await send("GET", "/api/goals");
    expect(first.body).toEqual({ text: STARTER_GOALS, written: false });
    const saved = await send("PUT", "/api/goals", { text: "Backend roles, remote in Europe." });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ text: "Backend roles, remote in Europe.", written: true });
    expect((await send("GET", "/api/goals")).body["written"]).toBe(true);
  });

  it("counts the starter text saved back unchanged as not written", async () => {
    await start({ goals: createGoalsStore(folder) });
    const reply = await send("PUT", "/api/goals", { text: STARTER_GOALS });
    expect(reply.body["written"]).toBe(false);
  });

  it("refuses text longer than the cap with a sentence and keeps the old goals", async () => {
    await start({ goals: createGoalsStore(folder) });
    await send("PUT", "/api/goals", { text: "Keep me." });
    const reply = await send("PUT", "/api/goals", {
      text: "x".repeat(MAXIMUM_GOALS_CHARACTERS + 1),
    });
    expect(reply.status).toBe(400);
    expect(String(reply.body["error"])).toContain("Shorten it");
    expect((await send("GET", "/api/goals")).body["text"]).toBe("Keep me.");
  });

  it("refuses a body without text and a request from another site", async () => {
    await start({ goals: createGoalsStore(folder) });
    expect((await send("PUT", "/api/goals", {})).status).toBe(400);
    expect((await send("PUT", "/api/goals", { text: "x" }, "http://evil.example")).status).toBe(
      403,
    );
    expect((await send("GET", "/api/goals")).body["written"]).toBe(false);
  });
});
