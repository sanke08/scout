import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeBrain, type ProcessRunner } from "../brain/index.js";
import { createApplication, COOLDOWN_DAYS } from "./application.js";
import { makeNumberedPosting, makeTestApplication, type TestApplication } from "./test-helpers.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("createApplication", () => {
  it("creates the data folder and its database, and needs no profile yet", () => {
    const parent = mkdtempSync(join(tmpdir(), "scout-app-root-"));
    cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    const directory = join(parent, "nested", "data");
    const application = createApplication({ directory });
    try {
      expect(existsSync(join(directory, "scout.sqlite"))).toBe(true);
      expect(application.profileStore.exists()).toBe(false);
      expect(application.boardStore.list()).toEqual([]);
    } finally {
      application.close();
    }
  });

  it("uses SCOUT_DATA_DIR when no directory is given", () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-app-env-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const before = process.env["SCOUT_DATA_DIR"];
    process.env["SCOUT_DATA_DIR"] = directory;
    try {
      const application = createApplication();
      expect(application.directory).toBe(directory);
      application.close();
    } finally {
      if (before === undefined) delete process.env["SCOUT_DATA_DIR"];
      else process.env["SCOUT_DATA_DIR"] = before;
    }
  });

  it("returns an injected brain as it is", () => {
    const brain = createFakeBrain([]);
    const test: TestApplication = makeTestApplication([], { brain });
    cleanups.push(test.cleanUp);
    expect(test.application.brain()).toBe(brain);
  });

  it("builds the real brain only on first use, and says to run init when there is no profile", () => {
    const test = makeTestApplication([], {}, false);
    cleanups.push(test.cleanUp);
    expect(() => test.application.brain()).toThrowError(/profile/i);
    const withProfile = makeTestApplication([], {});
    cleanups.push(withProfile.cleanUp);
    expect(withProfile.application.brain().name).toBe("claude");
  });

  it("ignores the deprecated engine settings and always uses claude", () => {
    const test = makeTestApplication([], {});
    cleanups.push(test.cleanUp);
    test.application.settingsStore.save({
      ...test.application.settingsStore.load(),
      mainEngine: "codex",
      switchEngineOnLimit: true,
    });
    expect(test.application.brain().name).toBe("claude");
  });

  it("puts a company in cooldown after an application to it", () => {
    const posting = makeNumberedPosting(1);
    const test = makeTestApplication([], {});
    cleanups.push(test.cleanUp);
    const { application } = test;
    const profile = application.profileStore.load();
    const settings = application.settingsStore.load();
    expect(application.decider().applyHardRules(posting, profile, settings).keep).toBe(true);
    application.jobStore.upsertPosting(makeNumberedPosting(2, { company: posting.company }));
    for (const status of [
      "shortlisted",
      "resume-ready",
      "approved",
      "submitting",
      "applied",
    ] as const) {
      application.jobStore.transition("posting-2", status, "test");
    }
    const verdict = application.decider().applyHardRules(posting, profile, settings);
    expect(verdict.keep).toBe(false);
    expect(verdict.reasons.join(" ")).toContain(`${COOLDOWN_DAYS} days`);
  });

  it("applies the blacklist option", () => {
    const test = makeTestApplication([], { blacklist: ["Northwind Labs"] });
    cleanups.push(test.cleanUp);
    const { application } = test;
    const verdict = application
      .decider()
      .applyHardRules(
        makeNumberedPosting(1),
        application.profileStore.load(),
        application.settingsStore.load(),
      );
    expect(verdict.keep).toBe(false);
  });

  it("runs the real brain through the injected process runner on Sonnet 5.5, never starts codex, and caches replies in the data folder", async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stdout: JSON.stringify({ answer: 7 }), stderr: "" };
    };
    const test = makeTestApplication([], { processRunner: runner });
    cleanups.push(test.cleanUp);
    const request = {
      task: "ask",
      instructions: "Answer.",
      schema: z.object({ answer: z.number() }),
    };
    const first = await test.application.brain().run(request);
    expect(first).toMatchObject({ ok: true, engine: "claude", cached: false });
    const second = await test.application.brain().run(request);
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(calls.map((call) => call.command)).toEqual(["claude"]);
    expect(calls[0]?.args).toContain("claude-sonnet-5-5");
    expect(existsSync(join(test.directory, "model-budget.json"))).toBe(true);
    expect(existsSync(join(test.directory, "brain-cache"))).toBe(true);
  });
});
