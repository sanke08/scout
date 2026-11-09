/**
 * Tests of the Control tab's routes over real HTTP with fakes. Properties that must stay true: only
 * one action runs at a time and a failure is a recorded result, never a crash; the kill switch and
 * missing mail settings stop the inbox before it starts; a request from another site starts
 * nothing; a risky platform change needs the platform name typed (checked by the server); and no
 * password is ever accepted or returned.
 */
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeVault } from "../platforms/fake-vault.js";
import type { PlatformSession, SessionStore } from "../platforms/index.js";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  type JobRecord,
  type JobStore,
  type Settings,
  type SettingsStore,
} from "../shared/index.js";
import type { HealthReport } from "../folders/index.js";
import {
  createActionRunner,
  startWebServer,
  type ActionDefinition,
  type RunningWebServer,
  type WebDependencies,
} from "./index.js";

/** Settings kept in memory. */
class FakeSettingsStore implements SettingsStore {
  settings: Settings = { ...DEFAULT_SETTINGS };
  saves = 0;
  load(): Settings {
    return { ...this.settings };
  }
  save(settings: Settings): Settings {
    this.settings = { ...settings };
    this.saves += 1;
    return { ...settings };
  }
}

/** A job store that only lists the approved job. */
const approvedJob = {
  id: "job-9",
  company: "ExampleCorp",
  title: "Backend Engineer",
  location: "Remote",
  remote: "remote",
  board: "greenhouse",
  canonicalUrl: "https://example.com/jobs/9",
  firstSeenAt: "2026-11-05T08:00:00.000Z",
  sources: [],
  status: "approved",
  updatedAt: "2026-11-06T08:00:00.000Z",
} as unknown as JobRecord;
const fakeJobStore = {
  list: () => [approvedJob],
  get: () => undefined,
} as unknown as JobStore;

/** Sign-in records in memory. */
function fakeSessions(records: Record<string, PlatformSession> = {}): SessionStore {
  return {
    get: (platform) => records[platform],
    list: () => ({ ...records }),
    update: () => undefined,
    clearSignIns: () => undefined,
    remove: () => undefined,
  };
}

/** The reply of one request. */
interface Reply {
  status: number;
  body: Record<string, unknown>;
}

let server: RunningWebServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Starts a server with the given extras. */
async function start(extra: Partial<WebDependencies>, settingsStore = new FakeSettingsStore()) {
  server = await startWebServer(
    {
      profileStore: {} as never,
      resumeBuilder: {} as never,
      digestProvider: () => [],
      settingsStore,
      jobStore: fakeJobStore,
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
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** An action whose end the test controls. */
function controlledAction(name: string, check?: () => void) {
  const control: { finish: (outcome: { summary: string }) => void; fail: (error: Error) => void } =
    { finish: () => undefined, fail: () => undefined };
  let runs = 0;
  const definition: ActionDefinition = {
    name,
    ...(check === undefined ? {} : { check }),
    run: () => {
      runs += 1;
      return new Promise((resolve, reject) => {
        control.finish = resolve;
        control.fail = reject;
      });
    },
  };
  return { definition, control, runs: () => runs };
}

/** Lets pending promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("actions", () => {
  it("answers 404 when the server has no runner", async () => {
    await start({});
    expect((await send("GET", "/api/actions")).status).toBe(404);
    expect((await send("POST", "/api/actions/discover")).status).toBe(404);
  });

  it("starts one action, refuses a second while it runs and records the result", async () => {
    const discover = controlledAction("discover");
    const inbox = controlledAction("inbox");
    await start({
      actions: createActionRunner(
        [discover.definition, inbox.definition],
        () => new Date("2026-11-09T10:00:00.000Z"),
      ),
    });
    const started = await send("POST", "/api/actions/discover");
    expect(started.status).toBe(202);
    expect(started.body["running"]).toMatchObject({ name: "discover" });

    expect((await send("POST", "/api/actions/discover")).status).toBe(409);
    expect((await send("POST", "/api/actions/inbox")).status).toBe(409);
    expect(inbox.runs()).toBe(0);
    expect(discover.runs()).toBe(1);

    discover.control.finish({ summary: "Read 2 boards, 1 shortlisted." });
    await settle();
    const state = (await send("GET", "/api/actions")).body;
    expect(state["running"]).toBeNull();
    expect(state["last"]).toMatchObject({
      name: "discover",
      ok: true,
      summary: "Read 2 boards, 1 shortlisted.",
      finishedAt: "2026-11-09T10:00:00.000Z",
    });
    expect((await send("POST", "/api/actions/inbox")).status).toBe(202);
  });

  it("records a failure as a failed result and keeps serving", async () => {
    const discover = controlledAction("discover");
    await start({ actions: createActionRunner([discover.definition]) });
    await send("POST", "/api/actions/discover");
    discover.control.fail(new ScoutError("not-found", "There is no profile yet. Run scout init."));
    await settle();
    const failed = (await send("GET", "/api/actions")).body["last"];
    expect(failed).toMatchObject({
      ok: false,
      summary: "There is no profile yet. Run scout init.",
    });

    await send("POST", "/api/actions/discover");
    discover.control.fail(new Error("connect failed for alex@example.com password hunter2"));
    await settle();
    const unexpected = (await send("GET", "/api/actions")).body["last"] as { summary: string };
    expect(unexpected.summary).toMatch(/unexpected problem/);
    expect(JSON.stringify(unexpected)).not.toContain("hunter2");
    expect((await send("GET", "/api/actions")).status).toBe(200);
  });

  it("refuses the inbox when its check fails and starts nothing", async () => {
    const paused = controlledAction("inbox", () => {
      throw new ScoutError("paused", "Automation is paused. Run scout unpause first.");
    });
    await start({ actions: createActionRunner([paused.definition]) });
    const reply = await send("POST", "/api/actions/inbox");
    expect(reply.status).toBe(409);
    expect(String(reply.body["error"])).toMatch(/paused/);
    expect(paused.runs()).toBe(0);
    expect((await send("GET", "/api/actions")).body["running"]).toBeNull();

    const missing = controlledAction("inbox", () => {
      throw new ScoutError("invalid-input", "These are not set: SCOUT_IMAP_HOST.");
    });
    await server?.close();
    await start({ actions: createActionRunner([missing.definition]) });
    const refused = await send("POST", "/api/actions/inbox");
    expect(refused.status).toBe(400);
    expect(String(refused.body["error"])).toContain("SCOUT_IMAP_HOST");
    expect(missing.runs()).toBe(0);
  });

  it("starts nothing for a request from another site and answers 404 for an unknown name", async () => {
    const discover = controlledAction("discover");
    await start({ actions: createActionRunner([discover.definition]) });
    const foreign = await send(
      "POST",
      "/api/actions/discover",
      undefined,
      "https://evil.example.com",
    );
    expect(foreign.status).toBe(403);
    expect(discover.runs()).toBe(0);
    expect((await send("POST", "/api/actions/other")).status).toBe(404);
    expect((await send("POST", "/api/actions/discover", { force: true })).status).toBe(400);
  });
});

describe("health", () => {
  it("adds the report and the approved jobs only when a report is supplied", async () => {
    await start({});
    expect((await send("GET", "/api/health")).body).toEqual({ ok: true });
    await server?.close();
    const report = {
      automationPaused: false,
      modelCallsToday: 7,
      modelCallBudget: 40,
      needsYou: [],
      queueSizes: { approved: 1 },
    } as unknown as HealthReport;
    await start({ healthReport: () => report, modelName: "Sonnet 5.5" });
    const body = (await send("GET", "/api/health")).body;
    expect(body["report"]).toMatchObject({ modelCallsToday: 7, modelCallBudget: 40 });
    expect(body["modelName"]).toBe("Sonnet 5.5");
    expect(body["approved"]).toMatchObject([{ id: "job-9" }]);
  });
});

describe("platform routes", () => {
  const changes: string[] = [];
  const control = (supported = true) => ({
    sessions: fakeSessions({
      linkedin: { username: "alex@example.com", lastManualLoginAt: "2026-11-08T09:00:00.000Z" },
    }),
    vault: createFakeVault({
      supported,
      stored: { linkedin: { username: "alex@example.com", password: "not-a-real-password" } },
    }),
    recordChange: (detail: string) => changes.push(detail),
  });

  it("answers 404 without platform settings", async () => {
    await start({});
    expect((await send("GET", "/api/platforms")).status).toBe(404);
    expect((await send("PUT", "/api/platforms/linkedin", { level: "fill" })).status).toBe(404);
  });

  it("lists the three known platforms with credentials flag and last sign-in, and no secret", async () => {
    await start({ platforms: control() });
    const reply = await send("GET", "/api/platforms");
    const names = (reply.body["platforms"] as { name: string }[]).map((entry) => entry.name);
    expect(names).toEqual(["indeed", "linkedin", "naukri"]);
    const linkedin = (reply.body["platforms"] as Record<string, unknown>[]).find(
      (entry) => entry["name"] === "linkedin",
    );
    expect(linkedin).toMatchObject({
      known: true,
      login: "manual",
      level: "prepare",
      credentialsSaved: "yes",
      lastSignInAt: "2026-11-08T09:00:00.000Z",
    });
    expect(JSON.stringify(reply.body)).not.toContain("not-a-real-password");
    expect(JSON.stringify(reply.body)).not.toContain("alex@example.com");
  });

  it("saves a safe change at once and logs it", async () => {
    const store = await start({ platforms: control() });
    const reply = await send("PUT", "/api/platforms/linkedin", { level: "fill" });
    expect(reply.status).toBe(200);
    expect(store.settings.boardLevels["linkedin"]).toBe("fill");
    expect(changes).toContain("linkedin: login unchanged, level fill.");
  });

  it("refuses saved sign-in or an automatic level without the typed name, and changes nothing", async () => {
    const store = await start({ platforms: control() });
    for (const body of [
      { login: "saved" },
      { level: "auto" },
      { level: "auto", confirm: "yes" },
      { login: "saved", confirm: "indeed" },
    ]) {
      const reply = await send("PUT", "/api/platforms/linkedin", body);
      expect(reply.status).toBe(400);
    }
    expect(store.saves).toBe(0);
    const accepted = await send("PUT", "/api/platforms/linkedin", {
      level: "auto",
      confirm: " LinkedIn ",
    });
    expect(accepted.status).toBe(200);
    expect(store.settings.boardLevels["linkedin"]).toBe("auto");
  });

  it("refuses a bad name, an empty change, a password field, saved sign-in for an unknown site and a missing keychain", async () => {
    const store = await start({ platforms: control() });
    expect((await send("PUT", "/api/platforms/Bad%20Name!", { level: "fill" })).status).toBe(400);
    expect((await send("PUT", "/api/platforms/linkedin", {})).status).toBe(400);
    expect(
      (await send("PUT", "/api/platforms/linkedin", { login: "saved", password: "x" })).status,
    ).toBe(400);
    expect((await send("PUT", "/api/platforms/example", { login: "saved" })).status).toBe(400);
    expect(store.saves).toBe(0);
    await server?.close();
    const noKeychain = await start({ platforms: control(false) });
    const reply = await send("PUT", "/api/platforms/linkedin", {
      login: "saved",
      confirm: "linkedin",
    });
    expect(reply.status).toBe(503);
    expect(noKeychain.saves).toBe(0);
  });

  it("needs no typed name for an unknown platform's level", async () => {
    const store = await start({ platforms: control() });
    expect((await send("PUT", "/api/platforms/example", { level: "auto" })).status).toBe(200);
    expect(store.settings.boardLevels["example"]).toBe("auto");
  });
});
