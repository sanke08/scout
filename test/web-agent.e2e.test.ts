/**
 * End-to-end: the autopilot routes run against the REAL goals store, the real settings store and
 * the real application, with a fake controller standing in for the `claude` command. A new owner
 * cannot start until they write goals; once written, Start runs, the live state is readable, and
 * pausing automation in Settings stops the run. No model, no network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApplication,
  createWebDependencies,
  type ApplicationOptions,
} from "../src/app/index.js";
import { goalsAreStarter } from "../src/agent/index.js";
import type { AgentController, AgentState, AgentTask } from "../src/agent/index.js";
import { startWebServer, type RunningWebServer } from "../src/web/index.js";
import { ScoutError } from "../src/shared/index.js";
import { FIXED_NOW, makeDataFolder } from "./helpers.js";

/** A controller that refuses like the real one: paused, or goals still the starter text. */
function makeFakeController(
  isPaused: () => boolean,
  goalsAreWritten: () => boolean,
): AgentController & { stops: number } {
  let state: AgentState = { running: false, events: [] };
  const controller = {
    stops: 0,
    start(task: AgentTask): void {
      if (isPaused()) throw new ScoutError("paused", "Automation is paused. Resume it first.");
      if (!goalsAreWritten()) {
        throw new ScoutError(
          "invalid-input",
          "Write your goals first. They are still the starter text.",
        );
      }
      state = {
        running: true,
        task,
        startedAt: FIXED_NOW.toISOString(),
        events: [{ at: FIXED_NOW.toISOString(), kind: "system", summary: "Started." }],
      };
    },
    stop(): void {
      controller.stops += 1;
      state = { ...state, running: false };
    },
    state: () => state,
  };
  return controller;
}

let folder: ReturnType<typeof makeDataFolder>;
let server: RunningWebServer | undefined;

beforeEach(() => {
  folder = makeDataFolder();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  folder.remove();
});

describe("autopilot over the web API with the real stores", () => {
  it("needs written goals to start, runs, and is stopped by pausing automation", async () => {
    const options: ApplicationOptions = {
      directory: folder.directory,
      hostDelayMilliseconds: 0,
      now: () => FIXED_NOW,
    };
    const application = createApplication(options);
    const dependencies = createWebDependencies(application);
    const agent = makeFakeController(
      () => application.settingsStore.load().automationPaused,
      () => dependencies.goals !== undefined && !goalsAreStarter(dependencies.goals.load()),
    );
    server = await startWebServer({ ...dependencies, agent }, { port: 0 });
    const call = (method: string, path: string, body?: unknown): Promise<Response> =>
      fetch(`${server!.url}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: server!.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const starter = await call("POST", "/api/agent/start", { task: "hunt" });
    expect(starter.status).toBe(400);
    expect(agent.state().running).toBe(false);

    const saved = await call("PUT", "/api/goals", { text: "Backend roles, remote in Europe." });
    expect(((await saved.json()) as { written: boolean }).written).toBe(true);

    expect((await call("POST", "/api/agent/start", { task: "hunt" })).status).toBe(202);
    expect((await call("POST", "/api/agent/start", { task: "hunt" })).status).toBe(409);
    const live = (await (await call("GET", "/api/agent")).json()) as AgentState;
    expect(live.running).toBe(true);
    expect(live.events[0]?.summary).toBe("Started.");

    const settings = application.settingsStore.load();
    const paused = await call("PUT", "/api/settings", { ...settings, automationPaused: true });
    expect(paused.status).toBe(200);
    expect(agent.stops).toBe(1);
    expect(((await (await call("GET", "/api/agent")).json()) as AgentState).running).toBe(false);
    expect((await call("POST", "/api/agent/start", { task: "hunt" })).status).toBe(409);
  });

  it("wires the real controller and goals store into the dependencies", () => {
    const application = createApplication({ directory: folder.directory, now: () => FIXED_NOW });
    const dependencies = createWebDependencies(application);
    expect(dependencies.agent?.state().running).toBe(false);
    expect(dependencies.goals?.load()).toBeDefined();
  });
});
