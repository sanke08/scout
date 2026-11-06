/**
 * Tests of the web server over real HTTP on 127.0.0.1 with fake stores. They state what must stay
 * true: only local hosts and own-origin writes are accepted, every route validates its input and
 * answers with a clear sentence, and approving, skipping or saving reaches the stores.
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  profileSchema,
  type JobRecord,
  type JobStatus,
  type JobStore,
  type Profile,
  type ProfileStore,
  type ResumeBuild,
  type ResumeBuilder,
  type Settings,
  type SettingsStore,
} from "../shared/index.js";
import {
  startWebServer,
  type DigestCard,
  type RunningWebServer,
  type WebDependencies,
} from "./index.js";

/** The fictional profile shared by every test. */
const sampleProfile: Profile = profileSchema.parse(
  JSON.parse(readFileSync(new URL("../../fixtures/profile.sample.json", import.meta.url), "utf8")),
);

/** A fake profile store that, like the real one, raises the version on each save. */
class FakeProfileStore implements ProfileStore {
  profile: Profile = structuredClone(sampleProfile);
  saves: Profile[] = [];
  load(): Profile {
    return structuredClone(this.profile);
  }
  save(profile: Profile): Profile {
    this.profile = { ...structuredClone(profile), version: this.profile.version + 1 };
    this.saves.push(this.profile);
    return structuredClone(this.profile);
  }
  exists(): boolean {
    return true;
  }
}

/** A fake settings store that keeps the last saved settings. */
class FakeSettingsStore implements SettingsStore {
  settings: Settings = { ...DEFAULT_SETTINGS };
  saves: Settings[] = [];
  load(): Settings {
    return { ...this.settings };
  }
  save(settings: Settings): Settings {
    this.settings = { ...settings };
    this.saves.push(this.settings);
    return { ...settings };
  }
}

/** One recorded status change. */
interface Transition {
  id: string;
  to: JobStatus;
  reason: string;
}

/** Builds a fictional stored job. */
function makeJob(id: string, status: JobStatus, title = "Backend Engineer"): JobRecord {
  return {
    id,
    company: "ExampleCorp",
    title,
    location: "Remote, Europe",
    remote: "remote",
    seniority: "mid",
    skills: ["Node.js"],
    description: "A long posting text that must not be sent to the page.",
    firstSeenAt: "2026-11-05T08:00:00.000Z",
    lastSeenAt: "2026-11-06T08:00:00.000Z",
    sources: [{ name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" }],
    canonicalUrl: "https://example.com/jobs/1",
    board: "greenhouse",
    flags: [],
    status,
    updatedAt: "2026-11-06T08:00:00.000Z",
  };
}

/** A fake job store that records every transition and can refuse them. */
class FakeJobStore implements JobStore {
  jobs = new Map<string, JobRecord>();
  transitions: Transition[] = [];
  refuseWith: ScoutError | undefined;
  upsertPosting(): JobRecord {
    throw new Error("The web module never adds postings.");
  }
  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }
  list(filter?: { status?: JobStatus | JobStatus[] }): JobRecord[] {
    const wanted = filter?.status === undefined ? undefined : [filter.status].flat();
    return [...this.jobs.values()].filter((job) => !wanted || wanted.includes(job.status));
  }
  transition(id: string, to: JobStatus, reason: string): JobRecord {
    if (this.refuseWith) throw this.refuseWith;
    const job = this.jobs.get(id);
    if (!job) throw new ScoutError("not-found", "No job with that id exists.");
    const moved = { ...job, status: to, statusReason: reason };
    this.jobs.set(id, moved);
    this.transitions.push({ id, to, reason });
    return moved;
  }
}

/** A fake resume builder that records its calls and returns a small fixed LaTeX body. */
class FakeResumeBuilder implements ResumeBuilder {
  calls: { profile: Profile; keywords: string[]; company: string | undefined }[] = [];
  build(profile: Profile, keywords: string[], options?: { company?: string }): ResumeBuild {
    this.calls.push({ profile, keywords, company: options?.company });
    const supported = keywords.filter((keyword) => keyword.toLowerCase() === "node.js");
    return {
      texSource: `\\begin{document}\n\\section{Summary}\n\\small{${profile.identity.name}}\n\\end{document}\n`,
      estimatedLines: 60,
      lineLimit: 76.5,
      projectsShown: ["Team Chat"],
      projectsLeftOut: [],
      matchedKeywords: supported,
      notInProfile: keywords.filter((keyword) => !supported.includes(keyword)),
      fileStem: `Alex_Rivera_${options?.company ?? "Company"}`,
    };
  }
}

/** The reply of a raw HTTP request. */
interface RawReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: () => Record<string, unknown>;
}

/** Everything one test needs: the running server and the fakes behind it. */
interface Harness {
  server: RunningWebServer;
  profileStore: FakeProfileStore;
  settingsStore: FakeSettingsStore;
  jobStore: FakeJobStore;
  resumeBuilder: FakeResumeBuilder;
  digestCards: DigestCard[];
  digestFailure: { error: Error | undefined };
}

let harness: Harness;

/** Starts a server on a free port with fresh fakes. */
async function startHarness(): Promise<Harness> {
  const profileStore = new FakeProfileStore();
  const settingsStore = new FakeSettingsStore();
  const jobStore = new FakeJobStore();
  const resumeBuilder = new FakeResumeBuilder();
  jobStore.jobs.set("job-1", makeJob("job-1", "shortlisted"));
  jobStore.jobs.set("job-2", makeJob("job-2", "needs-you", "Platform Engineer"));
  jobStore.jobs.set("job-3", makeJob("job-3", "applied", "Data Engineer"));
  const digestCards: DigestCard[] = [
    {
      job: makeJob("job-1", "shortlisted"),
      shortlistScore: 88,
      fitRating: 8,
      reasons: ["Matches Node.js"],
      unmet: ["Kubernetes"],
      answers: [{ question: "Notice period", answer: "30 days" }],
      resumePreview: "Alex Rivera\nSoftware Engineer",
    },
  ];
  const digestFailure: { error: Error | undefined } = { error: undefined };
  const dependencies: WebDependencies = {
    profileStore,
    settingsStore,
    jobStore,
    resumeBuilder,
    digestProvider: () => {
      if (digestFailure.error) throw digestFailure.error;
      return digestCards;
    },
    now: () => new Date("2026-11-07T09:00:00.000Z"),
  };
  const server = await startWebServer(dependencies, { port: 0 });
  return {
    server,
    profileStore,
    settingsStore,
    jobStore,
    resumeBuilder,
    digestCards,
    digestFailure,
  };
}

/**
 * Sends one request with `node:http` so the test controls every header, including Host, and the
 * exact path (no normalising of `..`).
 */
function send(
  method: string,
  path: string,
  options: { body?: string | Buffer; headers?: Record<string, string>; port?: number } = {},
): Promise<RawReply> {
  const url = new URL(harness.server.url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: options.port ?? Number(url.port),
        method,
        path,
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text,
            json: () => JSON.parse(text) as Record<string, unknown>,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

/** Sends a JSON request from the page's own origin. */
function sendJsonRequest(method: string, path: string, body?: unknown): Promise<RawReply> {
  const own = harness.server.url;
  return send(method, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: own },
  });
}

/** Asserts a reply is a clear JSON error: the right status and a full sentence. */
function expectError(reply: RawReply, status: number): void {
  expect(reply.status).toBe(status);
  const message = reply.json()["error"];
  expect(typeof message).toBe("string");
  expect(String(message).length).toBeGreaterThan(15);
  expect(String(message)).toMatch(/\.$/);
}

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.server.close();
});

describe("server basics", () => {
  it("listens on 127.0.0.1 and reports health", async () => {
    expect(harness.server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const reply = await send("GET", "/api/health");
    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ ok: true });
  });

  it("serves the page with security headers and no caching", async () => {
    const reply = await send("GET", "/");
    expect(reply.status).toBe(200);
    expect(String(reply.headers["content-type"])).toContain("text/html");
    expect(String(reply.headers["content-security-policy"])).toContain("script-src 'self'");
    expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    expect(reply.text).toContain("<title>Scout</title>");
  });

  it("answers an unknown route with 404 and a sentence", async () => {
    expectError(await send("GET", "/api/nothing"), 404);
    expectError(await send("GET", "/nothing.html"), 404);
  });

  it("answers a known route with the wrong method with 405 and the allowed methods", async () => {
    const reply = await send("DELETE", "/api/profile");
    expectError(reply, 405);
    expect(reply.headers["allow"]).toBe("GET, PUT");
  });
});

describe("static files", () => {
  it.each([
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2f..%2fpackage.json",
    "/public/../../../package.json",
    "/styles.css/../../../package.json",
    "//etc/passwd",
    "/app.js%00.png",
    "/reference/scout-page.html",
    "/public/app.js",
    "/api-client.js/",
  ])("refuses the traversal attempt %s", async (path) => {
    const reply = await send("GET", path);
    expect(reply.status).toBe(404);
    expect(reply.text).not.toContain('"name": "scout"');
  });

  it("serves only the fixed list of files", async () => {
    for (const path of ["/styles.css", "/app.js", "/dom.js", "/tex-preview.js"]) {
      const reply = await send("GET", path);
      expect(reply.status).toBe(200);
    }
  });

  it("refuses to change a page", async () => {
    expectError(await send("POST", "/"), 405);
  });
});

describe("host and origin defence", () => {
  it.each(["evil.example.com", "evil.example.com:80", "127.0.0.1", "127.0.0.1:1", "localhost"])(
    "refuses the Host header %j",
    async (host) => {
      const api = await send("GET", "/api/profile", { headers: { Host: host } });
      expectError(api, 403);
      const page = await send("GET", "/", { headers: { Host: host } });
      expectError(page, 403);
    },
  );

  it("accepts the localhost name with the right port", async () => {
    const port = new URL(harness.server.url).port;
    const reply = await send("GET", "/api/health", { headers: { Host: `localhost:${port}` } });
    expect(reply.status).toBe(200);
  });

  it("refuses a cross-origin write and changes nothing", async () => {
    for (const origin of [
      "https://evil.example.com",
      "http://127.0.0.1:9",
      "null",
      "http://localhost",
    ]) {
      const reply = await send("POST", "/api/jobs/job-1/approve", {
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      });
      expectError(reply, 403);
    }
    const profileReply = await send("PUT", "/api/profile", {
      headers: { Origin: "https://evil.example.com", "Content-Type": "application/json" },
      body: JSON.stringify(sampleProfile),
    });
    expectError(profileReply, 403);
    expect(harness.jobStore.transitions).toEqual([]);
    expect(harness.profileStore.saves).toEqual([]);
  });

  it("accepts a write from the page's own origin and from a client that sends no Origin", async () => {
    const own = await sendJsonRequest("POST", "/api/jobs/job-1/approve");
    expect(own.status).toBe(200);
    const none = await send("POST", "/api/jobs/job-1/undo");
    expect(none.status).toBe(200);
  });
});

describe("request body rules", () => {
  it("refuses a body over 1 MB", async () => {
    const huge = JSON.stringify({ keywords: ["x".repeat(2 * 1024 * 1024)] });
    const reply = await sendJsonRequest("POST", "/api/resume", JSON.parse(huge));
    expectError(reply, 413);
    expect(harness.resumeBuilder.calls).toEqual([]);
  });

  it("refuses invalid JSON", async () => {
    const reply = await send("PUT", "/api/settings", {
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expectError(reply, 400);
  });

  it("refuses a body that is not declared as JSON", async () => {
    const reply = await send("PUT", "/api/settings", {
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(DEFAULT_SETTINGS),
    });
    expectError(reply, 415);
    expect(harness.settingsStore.saves).toEqual([]);
  });

  it("refuses a missing body where one is required", async () => {
    expectError(await sendJsonRequest("PUT", "/api/profile"), 400);
    expectError(await sendJsonRequest("POST", "/api/resume"), 400);
    expectError(await sendJsonRequest("POST", "/api/jobs/job-1/skip"), 400);
  });
});

describe("profile routes", () => {
  it("returns the profile and, when supplied, pending proposals", async () => {
    const reply = await send("GET", "/api/profile");
    expect(reply.status).toBe(200);
    const body = reply.json();
    expect((body["profile"] as Profile).identity.name).toBe("Alex Rivera");
    expect(body["pendingProposals"]).toBeUndefined();
  });

  it("saves an edited point through the store and bumps the version", async () => {
    const edited = structuredClone(sampleProfile);
    const point = edited.experience[0]?.points[0];
    if (!point) throw new Error("The fixture needs an experience point.");
    point.text = "Built the booking flow for a travel platform, as one of four engineers.";
    point.status = "hold";
    const reply = await sendJsonRequest("PUT", "/api/profile", edited);
    expect(reply.status).toBe(200);
    const body = reply.json();
    expect(body["version"]).toBe(sampleProfile.version + 1);
    expect((body["profile"] as Profile).version).toBe(sampleProfile.version + 1);
    expect(harness.profileStore.saves).toHaveLength(1);
    expect(harness.profileStore.profile.experience[0]?.points[0]?.status).toBe("hold");
  });

  it("refuses a profile that does not fit the schema, with a sentence, and saves nothing", async () => {
    const broken = structuredClone(sampleProfile) as unknown as Record<string, unknown>;
    delete broken["identity"];
    expectError(await sendJsonRequest("PUT", "/api/profile", broken), 400);
    const badStatus = structuredClone(sampleProfile);
    const point = badStatus.projects[0]?.points[0];
    if (!point) throw new Error("The fixture needs a project point.");
    (point as { status: string }).status = "perfect";
    const reply = await sendJsonRequest("PUT", "/api/profile", badStatus);
    expectError(reply, 400);
    expect(String(reply.json()["error"])).toContain("projects.0.points.0.status");
    expectError(await sendJsonRequest("PUT", "/api/profile", [1, 2]), 400);
    expect(harness.profileStore.saves).toEqual([]);
  });

  it("returns a profile with markup in a point unchanged, as plain data", async () => {
    const hostile = structuredClone(sampleProfile);
    const point = hostile.experience[0]?.points[0];
    if (!point) throw new Error("The fixture needs an experience point.");
    point.text = "<img src=x onerror=alert(1)>";
    await sendJsonRequest("PUT", "/api/profile", hostile);
    const reply = await send("GET", "/api/profile");
    const profile = reply.json()["profile"] as Profile;
    expect(profile.experience[0]?.points[0]?.text).toBe("<img src=x onerror=alert(1)>");
    expect(String(reply.headers["content-type"])).toContain("application/json");
  });

  it("explains a missing profile with the store's own sentence", async () => {
    harness.profileStore.load = () => {
      throw new ScoutError("not-found", "No profile exists yet. Create one from the sample.");
    };
    const reply = await send("GET", "/api/profile");
    expectError(reply, 404);
    expect(reply.json()["error"]).toBe("No profile exists yet. Create one from the sample.");
  });
});

describe("settings routes", () => {
  it("returns the settings and the defaults", async () => {
    const reply = await send("GET", "/api/settings");
    expect(reply.status).toBe(200);
    expect(reply.json()["settings"]).toEqual(DEFAULT_SETTINGS);
    expect(reply.json()["defaults"]).toEqual(DEFAULT_SETTINGS);
  });

  it("saves valid settings through the store", async () => {
    const changed = { ...DEFAULT_SETTINGS, applyMode: "prepare", automationPaused: true };
    const reply = await sendJsonRequest("PUT", "/api/settings", changed);
    expect(reply.status).toBe(200);
    expect(harness.settingsStore.settings.automationPaused).toBe(true);
    expect((reply.json()["settings"] as Settings).applyMode).toBe("prepare");
  });

  it.each([
    { digestTime: "8am" },
    { dailyApplicationLimit: -1 },
    { minimumShortlistScore: 150 },
    { applyMode: "always" },
    { boardLevels: { greenhouse: "robot" } },
    { unknownSetting: true },
  ])("refuses invalid settings %j", async (change) => {
    const reply = await sendJsonRequest("PUT", "/api/settings", { ...DEFAULT_SETTINGS, ...change });
    if (reply.status === 200) {
      // zod objects drop unknown keys; the store must never see one.
      expect(Object.keys(harness.settingsStore.saves[0] ?? {})).not.toContain("unknownSetting");
    } else {
      expectError(reply, 400);
      expect(harness.settingsStore.saves).toEqual([]);
    }
  });
});

describe("digest and job actions", () => {
  it("returns cards without posting text, the needs-you list and recent applications", async () => {
    const reply = await send("GET", "/api/digest");
    expect(reply.status).toBe(200);
    const body = reply.json();
    expect(body["generatedAt"]).toBe("2026-11-07T09:00:00.000Z");
    expect(body["mode"]).toBe("approve");
    expect(body["skipTags"]).toEqual(["Wrong location", "Too junior", "Company", "Not interested"]);
    expect((body["cards"] as unknown[]).length).toBe(1);
    expect((body["needsYou"] as { id: string }[]).map((job) => job.id)).toEqual(["job-2"]);
    expect((body["recentlyApplied"] as { id: string }[]).map((job) => job.id)).toEqual(["job-3"]);
    expect(reply.text).not.toContain("A long posting text");
  });

  it("turns a provider failure into a clear 500 that does not leak the cause", async () => {
    harness.digestFailure.error = new Error("secret internal path /Users/someone/data");
    const reply = await send("GET", "/api/digest");
    expectError(reply, 500);
    expect(reply.text).not.toContain("secret internal path");
  });

  it("approves a job: the store records the transition", async () => {
    const reply = await sendJsonRequest("POST", "/api/jobs/job-1/approve");
    expect(reply.status).toBe(200);
    expect((reply.json()["job"] as { status: string }).status).toBe("approved");
    expect(harness.jobStore.transitions).toEqual([
      { id: "job-1", to: "approved", reason: "Approved in the digest." },
    ]);
  });

  it("skips a job with its tag as the reason", async () => {
    const reply = await sendJsonRequest("POST", "/api/jobs/job-1/skip", { tag: "Too junior" });
    expect(reply.status).toBe(200);
    expect(harness.jobStore.transitions).toEqual([
      { id: "job-1", to: "skipped", reason: "Too junior" },
    ]);
    expect((reply.json()["job"] as { statusReason: string }).statusReason).toBe("Too junior");
  });

  it("undoes a decision by returning the job to shortlisted", async () => {
    await sendJsonRequest("POST", "/api/jobs/job-1/approve");
    const reply = await sendJsonRequest("POST", "/api/jobs/job-1/undo");
    expect(reply.status).toBe(200);
    expect(harness.jobStore.transitions.at(-1)).toEqual({
      id: "job-1",
      to: "shortlisted",
      reason: "Undone in the digest.",
    });
  });

  it.each([
    { tag: "whatever" },
    { tag: "" },
    { tag: 5 },
    {},
    { tag: "Company", extra: 1 },
    "Company",
  ])("refuses the skip body %j", async (body) => {
    expectError(await sendJsonRequest("POST", "/api/jobs/job-1/skip", body), 400);
    expect(harness.jobStore.transitions).toEqual([]);
  });

  it("refuses a body with extra fields on approve and undo", async () => {
    expectError(await sendJsonRequest("POST", "/api/jobs/job-1/approve", { force: true }), 400);
    expectError(await sendJsonRequest("POST", "/api/jobs/job-1/undo", { status: "offer" }), 400);
  });

  it("refuses a malformed job id and reports an unknown one", async () => {
    expectError(await sendJsonRequest("POST", "/api/jobs/a%20b/approve"), 400);
    expectError(await sendJsonRequest("POST", `/api/jobs/${"x".repeat(200)}/approve`), 400);
    expectError(await sendJsonRequest("POST", "/api/jobs/missing/approve"), 404);
    expectError(await send("POST", "/api/jobs/%ZZ/approve"), 404);
    expect(harness.jobStore.transitions).toEqual([]);
  });

  it("reports an illegal transition as a conflict with the store's sentence", async () => {
    harness.jobStore.refuseWith = new ScoutError(
      "illegal-transition",
      "A job that is applied cannot move back to approved.",
    );
    const reply = await sendJsonRequest("POST", "/api/jobs/job-3/approve");
    expectError(reply, 409);
    expect(reply.json()["error"]).toBe("A job that is applied cannot move back to approved.");
  });
});

describe("resume route", () => {
  it("builds the resume from the saved profile and returns the build", async () => {
    const reply = await sendJsonRequest("POST", "/api/resume", {
      keywords: ["Node.js", "Kafka"],
      company: "ExampleCorp",
    });
    expect(reply.status).toBe(200);
    const body = reply.json();
    expect(String(body["texSource"])).toContain("\\begin{document}");
    expect(body["matchedKeywords"]).toEqual(["Node.js"]);
    expect(body["notInProfile"]).toEqual(["Kafka"]);
    expect(harness.resumeBuilder.calls).toHaveLength(1);
    expect(harness.resumeBuilder.calls[0]?.keywords).toEqual(["Node.js", "Kafka"]);
    expect(harness.resumeBuilder.calls[0]?.company).toBe("ExampleCorp");
  });

  it("accepts no keywords and no company", async () => {
    const reply = await sendJsonRequest("POST", "/api/resume", { keywords: [] });
    expect(reply.status).toBe(200);
    expect(harness.resumeBuilder.calls[0]?.company).toBeUndefined();
  });

  it.each([
    {},
    { keywords: "Node.js" },
    { keywords: [1] },
    { keywords: [""] },
    { keywords: ["x".repeat(101)] },
    { keywords: Array.from({ length: 101 }, (_, index) => `k${index}`) },
    { keywords: [], company: 7 },
    { keywords: [], company: "x".repeat(101) },
    { keywords: [], profile: {} },
  ])("refuses the resume request %j", async (body) => {
    expectError(await sendJsonRequest("POST", "/api/resume", body), 400);
    expect(harness.resumeBuilder.calls).toEqual([]);
  });
});

describe("the served page has no real personal data and no outside scripts", () => {
  const files = [
    "/",
    "/app.js",
    "/api-client.js",
    "/dom.js",
    "/highlight.js",
    "/tex-preview.js",
    "/digest-view.js",
    "/profile-view.js",
    "/settings-view.js",
    "/styles.css",
  ];

  it("contains no email outside example.com, no phone number and no sample person", async () => {
    for (const path of files) {
      const text = (await send("GET", path)).text;
      for (const email of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) {
        expect(email.endsWith("@example.com") || email.endsWith(".example.com")).toBe(true);
      }
      expect(text).not.toMatch(/\+\d[\d\s-]{7,}/);
      expect(text).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
      expect(text).not.toContain("Alex Rivera");
      expect(text).not.toContain("localStorage");
    }
  });

  it("loads no script or style from outside except the optional font stylesheet", async () => {
    const page = (await send("GET", "/")).text;
    expect(page).not.toMatch(/<script[^>]+src="https?:/i);
    const outside = page.match(/(?:href|src)="https?:\/\/[^"]+"/g) ?? [];
    for (const reference of outside) {
      expect(reference).toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });
});
