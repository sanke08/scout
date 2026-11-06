/**
 * End-to-end tests: every scenario goes through the real entry point `main(argv)`, with a fake
 * network (saved boards), a fake model and a fixed clock. Nothing here uses the real network, a
 * real model, `claude`, `codex` or real personal data.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication, type ApplicationOptions } from "../src/app/index.js";
import { createFakeBrain } from "../src/brain/index.js";
import { main } from "../src/index.js";
import {
  FIXED_NOW,
  makeDataFolder,
  makeFakeNetwork,
  makeScoringBrain,
  runCli,
  type FakeNetwork,
} from "./helpers.js";

let folder: ReturnType<typeof makeDataFolder>;
let network: FakeNetwork;

beforeEach(() => {
  folder = makeDataFolder();
  network = makeFakeNetwork();
});

afterEach(() => {
  folder.remove();
});

/** Overrides every test uses: the temporary folder, the fake network and a fixed clock. */
function baseOverrides(extra: ApplicationOptions = {}): ApplicationOptions {
  return {
    directory: folder.directory,
    fetchImpl: network.fetchImpl,
    hostDelayMilliseconds: 0,
    now: () => FIXED_NOW,
    ...extra,
  };
}

/** Adds the three example boards and the one that holds a junior role. */
async function addAllBoards(): Promise<void> {
  for (const [kind, token] of [
    ["greenhouse", "examplecorp"],
    ["lever", "examplecorp"],
    ["ashby", "examplecorp"],
    ["greenhouse", "harborjobs"],
  ]) {
    await runCli(["boards", "add", kind!, token!], baseOverrides());
  }
}

describe("scout init", () => {
  it("creates the data folder and a clearly labelled fictional sample profile", async () => {
    const result = await runCli(["init"], baseOverrides());
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(folder.directory, "profile.json"))).toBe(true);
    expect(existsSync(join(folder.directory, "settings.json"))).toBe(true);
    expect(result.lines.join("\n")).toMatch(/FICTIONAL SAMPLE/);
    expect(result.lines.join("\n")).toMatch(/Next steps/);
  });

  it("never overwrites a profile that already exists", async () => {
    await runCli(["init"], baseOverrides());
    const path = join(folder.directory, "profile.json");
    const edited = readFileSync(path, "utf8").replace("Alex Rivera", "Sam Example");
    writeFileSync(path, edited);
    const result = await runCli(["init"], baseOverrides());
    expect(readFileSync(path, "utf8")).toContain("Sam Example");
    expect(result.lines.join("\n")).toMatch(/already exists/);
  });
});

describe("scout profile", () => {
  it("shows and validates the sample profile", async () => {
    await runCli(["init"], baseOverrides());
    const shown = await runCli(["profile", "show"], baseOverrides());
    expect(shown.lines.join("\n")).toContain("Alex Rivera");
    const validated = await runCli(["profile", "validate"], baseOverrides());
    expect(validated.exitCode).toBe(0);
    expect(validated.lines.join("\n")).toMatch(/valid and complete/);
  });

  it("says in a full sentence what is wrong with an incomplete profile and sets the exit code", async () => {
    await runCli(["init"], baseOverrides());
    const path = join(folder.directory, "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8"));
    profile.preferences.targetRoles = [];
    writeFileSync(path, JSON.stringify(profile));
    const result = await runCli(["profile", "validate"], baseOverrides());
    expect(result.exitCode).toBe(2);
    expect(result.errors.join("\n")).toMatch(/not complete/);
  });

  it("tells a user without a profile to run init", async () => {
    const result = await runCli(["profile", "show"], baseOverrides());
    expect(result.exitCode).toBe(3);
    expect(result.errors.join("\n").length).toBeGreaterThan(20);
  });
});

describe("scout boards", () => {
  it("adds, lists and removes boards, and ignores a repeated add", async () => {
    await runCli(["boards", "add", "greenhouse", "examplecorp"], baseOverrides());
    const again = await runCli(["boards", "add", "greenhouse", "examplecorp"], baseOverrides());
    expect(again.lines.join("\n")).toMatch(/already on your list/);
    await runCli(["boards", "add", "https://jobs.lever.co/acme"], baseOverrides());
    const listed = await runCli(["boards", "list"], baseOverrides());
    expect(listed.lines).toEqual(["greenhouse:examplecorp", "lever:acme"]);
    await runCli(["boards", "remove", "lever", "acme"], baseOverrides());
    const after = await runCli(["boards", "list"], baseOverrides());
    expect(after.lines).toEqual(["greenhouse:examplecorp"]);
  });

  it("refuses an unknown kind and a board that is not on the list", async () => {
    const unknownKind = await runCli(["boards", "add", "myspace", "acme"], baseOverrides());
    expect(unknownKind.exitCode).toBe(2);
    const missing = await runCli(["boards", "remove", "lever", "nobody"], baseOverrides());
    expect(missing.exitCode).toBe(3);
  });
});

describe("scout discover", () => {
  it("finds, filters, scores and shortlists, and jobs shows the results with reasons", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    const brain = makeScoringBrain(85, 85);
    const discovered = await runCli(["discover"], baseOverrides({ brain }));
    expect(discovered.exitCode).toBe(0);
    expect(discovered.lines.join("\n")).toMatch(/Mode: model scoring/);

    const shortlisted = await runCli(["jobs", "--status", "shortlisted"], baseOverrides());
    expect(shortlisted.lines.join("\n")).toContain("Backend Engineer");

    const skipped = await runCli(["jobs", "--status", "skipped"], baseOverrides());
    const skippedText = skipped.lines.join("\n");
    expect(skippedText).toContain("Senior Backend Engineer");
    expect(skippedText).toMatch(/why: .*senior level/);
  });

  it("records every hard-rule drop as skipped with its reasons, never silently", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    const result = await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    const dropped = Number(/hard rules .*: (\d+)/.exec(result.lines.join("\n"))?.[1]);
    expect(dropped).toBeGreaterThan(0);

    const application = createApplication(baseOverrides());
    try {
      const skipped = application.jobStore.list({ status: "skipped" });
      const byRule = skipped.filter((job) => !job.statusReason?.startsWith("Low fit"));
      expect(byRule.length).toBe(dropped);
      for (const job of byRule) {
        expect(job.statusReason ?? "").not.toBe("");
        expect(job.statusReason).not.toBe("First seen.");
      }
      const logged = application.actionLog
        .recent(200)
        .filter((entry) => entry.detail.includes("-> skipped"));
      expect(logged.length).toBe(skipped.length);
    } finally {
      application.close();
    }
  });

  it("does not ask the model again about a job it already scored", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    const brain = makeScoringBrain(85, 85);
    await runCli(["discover"], baseOverrides({ brain }));
    const callsAfterFirst = brain.requestCount();
    expect(callsAfterFirst).toBeGreaterThan(0);
    await runCli(["discover"], baseOverrides({ brain }));
    expect(brain.requestCount()).toBe(callsAfterFirst);
  });

  it("degrades to keyword scores and says so when the model reports its limit", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    const brain = createFakeBrain([{ kind: "limit-reached", resetAt: "2026-11-08T00:00:00.000Z" }]);
    const result = await runCli(["discover"], baseOverrides({ brain }));
    const text = result.lines.join("\n");
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/MODE: degraded/);
    expect(text).toMatch(/usage limit was reached/);
    const shortlisted = await runCli(["jobs", "--status", "shortlisted"], baseOverrides());
    expect(shortlisted.lines.join("\n")).toMatch(/keyword match only/);
  });

  it("keeps going when one board cannot be read and reports it", async () => {
    await runCli(["init"], baseOverrides());
    await runCli(["boards", "add", "greenhouse", "nosuchcompany"], baseOverrides());
    await runCli(["boards", "add", "greenhouse", "harborjobs"], baseOverrides());
    const result = await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    const text = result.lines.join("\n");
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/Board greenhouse:nosuchcompany was not read/);
    expect(text).toMatch(/Shortlisted: 1/);
  });

  it("refuses to run without a profile and says how to get one", async () => {
    const result = await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    expect(result.exitCode).toBe(3);
    expect(result.errors.join("\n")).toMatch(/scout init/);
  });
});

describe("scout digest and resume", () => {
  it("prints shortlisted jobs with their reasons", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    const digest = await runCli(["digest"], baseOverrides());
    expect(digest.lines.join("\n")).toContain("Backend Engineer at Harborjobs");
    expect(digest.lines.join("\n")).toContain("Matches your Node.js work.");
  });

  it("writes a .tex whose text holds no keyword the profile lacks", async () => {
    await runCli(["init"], baseOverrides());
    const out = join(folder.directory, "out");
    const result = await runCli(
      [
        "resume",
        "--keywords",
        "Node.js,Kubernetes,Terraform",
        "--company",
        "Examplecorp",
        "--out",
        out,
      ],
      baseOverrides(),
    );
    expect(result.exitCode).toBe(0);
    const written = readdirSync(out).filter((name) => name.endsWith(".tex"));
    expect(written).toHaveLength(1);
    const source = readFileSync(join(out, written[0]!), "utf8");
    expect(source).toContain("Node.js");
    expect(source).not.toMatch(/Kubernetes|Terraform/);
    expect(result.lines.join("\n")).toMatch(/Not in your profile, so not added: .*kubernetes/i);
  });
});

describe("scout serve", () => {
  it("serves the health check and the digest on 127.0.0.1 and stops on Ctrl-C", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.join(" "));
    });
    const running = main(["node", "scout", "serve", "--port", "0"], baseOverrides());
    try {
      let url: string | undefined;
      for (let attempt = 0; attempt < 100 && url === undefined; attempt += 1) {
        url = lines.map((line) => /http:\/\/127\.0\.0\.1:\d+/.exec(line)?.[0]).find(Boolean);
        if (url === undefined) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(url).toBeDefined();
      const health = await fetch(`${url}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
      const digest = await fetch(`${url}/api/digest`);
      expect(digest.status).toBe(200);
      const body = (await digest.json()) as {
        cards: { job: { title: string }; resumePreview: string }[];
      };
      expect(body.cards.map((card) => card.job.title)).toContain("Backend Engineer");
      expect(body.cards[0]!.resumePreview).toContain("Alex Rivera");
      expect(body.cards[0]!.resumePreview).not.toMatch(/\\resume|\\section/);
    } finally {
      process.emit("SIGINT");
      await running;
      spy.mockRestore();
    }
    expect(lines.join("\n")).toMatch(/Scout stopped/);
  });

  it("rejects a bad port with a full sentence", async () => {
    await runCli(["init"], baseOverrides());
    const result = await runCli(["serve", "--port", "99999"], baseOverrides());
    expect(result.exitCode).toBe(2);
    expect(result.errors.join("\n")).toMatch(/port must be a whole number/);
  });
});

describe("scout pause and unpause", () => {
  it("lets discovery keep working while an acting step is refused with paused", async () => {
    await runCli(["init"], baseOverrides());
    await addAllBoards();
    const paused = await runCli(["pause"], baseOverrides());
    expect(paused.lines.join("\n")).toMatch(/paused/);

    const discovered = await runCli(
      ["discover"],
      baseOverrides({ brain: makeScoringBrain(85, 85) }),
    );
    expect(discovered.exitCode).toBe(0);
    expect(discovered.lines.join("\n")).toMatch(/Shortlisted: 1/);

    const application = createApplication(baseOverrides());
    try {
      expect(() => application.assertNotPaused()).toThrowError(/paused/);
      try {
        application.assertNotPaused();
      } catch (error) {
        expect((error as { code: string }).code).toBe("paused");
      }
    } finally {
      application.close();
    }

    await runCli(["unpause"], baseOverrides());
    const reopened = createApplication(baseOverrides());
    try {
      expect(() => reopened.assertNotPaused()).not.toThrow();
    } finally {
      reopened.close();
    }
  });
});
