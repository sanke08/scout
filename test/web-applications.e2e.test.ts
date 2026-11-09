/**
 * End-to-end: the Applications routes of the web server over real HTTP, backed by the real ledger in
 * a temporary data folder. A recruiter calls: the application is added, found by the recruiter's
 * phone, reported rejected, and its history shows both. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication, createWebDependencies, type Application } from "../src/app/index.js";
import { startWebServer, type RunningWebServer, type WebDependencies } from "../src/web/index.js";
import { FIXED_NOW, makeDataFolder } from "./helpers.js";

let folder: ReturnType<typeof makeDataFolder>;
let application: Application;
let server: RunningWebServer;

/** Starts a server over the temporary folder; `withLedger: false` leaves the ledger out. */
async function start(withLedger: boolean): Promise<void> {
  application = createApplication({ directory: folder.directory, now: () => FIXED_NOW });
  const dependencies: WebDependencies = createWebDependencies(application);
  if (!withLedger) delete dependencies.ledger;
  server = await startWebServer(dependencies, { port: 0 });
}

/** What `call` returns; the body is loose JSON so each test can read the fields it checks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: any };

/** Sends one request from the page's own origin and returns the status and parsed body. */
async function call(method: string, path: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json", origin: server.url },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** The body of a valid "add application" request. */
const alexApplication = {
  company: "Northwind",
  title: "Platform Engineer",
  link: "https://careers.example.com/jobs/NW-20931",
  appliedOn: "2026-11-02",
  details: {
    recruiterName: "Alex Rivera",
    recruiterPhone: "+1 555 0100",
    nextStepDate: "2026-11-06",
  },
};

beforeEach(() => {
  folder = makeDataFolder();
});

afterEach(async () => {
  await server.close();
  application.close();
  folder.remove();
});

describe("applications routes with a real ledger", () => {
  beforeEach(() => start(true));

  it("adds, finds by recruiter phone, reports rejected, and keeps both in the history", async () => {
    const added = await call("POST", "/api/applications", alexApplication);
    expect(added.status).toBe(201);
    const id: string = added.body.id;

    const found = await call("GET", `/api/applications?search=${encodeURIComponent("555 0100")}`);
    expect(found.status).toBe(200);
    expect(found.body.applications.map((entry: { id: string }) => entry.id)).toEqual([id]);
    expect(found.body.dueCount).toBe(1);

    const detail = await call("GET", `/api/applications/${id}`);
    expect(detail.body.allowedStatuses).toContain("rejected");

    const rejected = await call("POST", `/api/applications/${id}/status`, {
      status: "rejected",
      note: "Email from Alex Rivera",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.followUpDue).toBe(false);

    const history = (await call("GET", `/api/applications/${id}`)).body.events;
    const kinds = history.map((event: { kind: string }) => event.kind);
    expect(kinds).toContain("applied");
    expect(kinds[kinds.length - 1]).toBe("status");
  });

  it("filters by status and by due, and saves details and events", async () => {
    const id: string = (await call("POST", "/api/applications", alexApplication)).body.id;
    expect((await call("GET", "/api/applications?status=offer")).body.applications).toEqual([]);
    expect(
      (await call("GET", "/api/applications?status=applied&due=1")).body.applications,
    ).toHaveLength(1);

    const saved = await call("PUT", `/api/applications/${id}/details`, {
      recruiterEmail: "alex@example.com",
      nextStepDate: "",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.details.recruiterEmail).toBe("alex@example.com");
    expect((await call("GET", "/api/applications?due=1")).body.dueCount).toBe(0);

    const event = await call("POST", `/api/applications/${id}/events`, {
      kind: "call",
      summary: "Phone screen booked",
      contact: "Alex Rivera",
    });
    expect(event.status).toBe(201);
    expect(event.body.kind).toBe("call");
  });

  it("answers 409 with the ledger's sentence for a move that is not allowed", async () => {
    const id: string = (await call("POST", "/api/applications", alexApplication)).body.id;
    await call("POST", `/api/applications/${id}/status`, { status: "rejected" });
    const illegal = await call("POST", `/api/applications/${id}/status`, {
      status: "interviewing",
    });
    expect(illegal.status).toBe(409);
    expect(illegal.body.error).toContain("cannot be moved to interviewing");
  });

  it("answers 400 for bad bodies and bad filters, and 404 for an unknown application", async () => {
    const id: string = (await call("POST", "/api/applications", alexApplication)).body.id;
    expect((await call("POST", "/api/applications", { company: "" })).status).toBe(400);
    expect(
      (await call("POST", `/api/applications/${id}/status`, { status: "nonsense" })).status,
    ).toBe(400);
    expect((await call("GET", "/api/applications?status=nonsense")).status).toBe(400);
    expect(
      (await call("POST", `/api/applications/${id}/events`, { kind: "status", summary: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await call("POST", `/api/applications/${id}/events`, { kind: "applied", summary: "x" }))
        .status,
    ).toBe(400);
    expect(
      (await call("PUT", `/api/applications/${id}/details`, { nextStepDate: "soon" })).status,
    ).toBe(400);
    expect((await call("GET", "/api/applications/0000000000000000")).status).toBe(404);
    expect(
      (await call("POST", "/api/applications/0000000000000000/status", { status: "rejected" }))
        .status,
    ).toBe(404);
  });

  it("refuses a change that comes from another origin", async () => {
    const response = await fetch(`${server.url}/api/applications`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example.com" },
      body: JSON.stringify(alexApplication),
    });
    expect(response.status).toBe(403);
  });
});

describe("applications routes without a ledger", () => {
  beforeEach(() => start(false));

  it("answers 404 'Applications are not enabled.' on every route", async () => {
    const replies = [
      await call("GET", "/api/applications"),
      await call("GET", "/api/applications/abc"),
      await call("POST", "/api/applications", alexApplication),
      await call("PUT", "/api/applications/abc/details", {}),
      await call("POST", "/api/applications/abc/status", { status: "rejected" }),
      await call("POST", "/api/applications/abc/events", { kind: "note", summary: "x" }),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe("Applications are not enabled.");
    }
  });
});
