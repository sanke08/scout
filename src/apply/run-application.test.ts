import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardLevel, JobStatus, JobStore, Settings } from "../shared/index.js";
import { ScoutError } from "../shared/index.js";
import type { FakeDriver } from "./fake-driver.js";
import { mayAutoSubmit, runApplication, type RunArguments } from "./run-application.js";
import {
  driverFor,
  fixedClock,
  formHtml,
  makeJobStore,
  makeTemporaryFolder,
  planFor,
  sampleProfile,
  settingsWith,
} from "./test-helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** Settings that let an Automatic run submit: automatic mode, no dry run needed. */
const AUTO_SETTINGS = settingsWith({ applyMode: "auto", dryRunFirst: false });

/** Everything a run needs, with safe-to-submit defaults the test can override. */
function setup(
  options: {
    status?: JobStatus;
    settings?: Settings;
    level?: BoardLevel;
    driver?: FakeDriver;
    plan?: RunArguments["plan"];
    overrides?: Partial<RunArguments>;
  } = {},
) {
  const store = makeJobStore(options.status ?? "approved");
  cleanups.push(store.remove);
  const driver = options.driver ?? driverFor("greenhouse-style");
  const args: RunArguments = {
    driver,
    plan: options.plan ?? planFor("greenhouse-style"),
    level: options.level ?? "auto",
    mode: "live",
    settings: options.settings ?? AUTO_SETTINGS,
    jobs: store.jobs,
    jobId: "job-1",
    appliedToday: () => 0,
    boardHasCleanRun: true,
    now: fixedClock(),
    profileVersion: 3,
    ...options.overrides,
  };
  return { args, driver, jobs: store.jobs };
}

/** How many times the fake's submit was called. */
function submitCount(driver: FakeDriver): number {
  return driver.calls.filter((call) => call.startsWith("submit ")).length;
}

/** Runs the action and returns the ScoutError it rejects with. */
async function rejectionOf(action: Promise<unknown>): Promise<ScoutError> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(ScoutError);
    return error as ScoutError;
  }
  throw new Error("Expected a ScoutError but the call succeeded.");
}

describe("kill switch and job checks", () => {
  it("throws paused before touching the driver or the job", async () => {
    const { args, driver, jobs } = setup({
      settings: settingsWith({ ...AUTO_SETTINGS, automationPaused: true }),
    });
    const error = await rejectionOf(runApplication(args));
    expect(error.code).toBe("paused");
    expect(driver.calls).toEqual([]);
    expect(jobs.get("job-1")?.status).toBe("approved");
  });

  it("refuses a job that is not resume-ready or approved", async () => {
    const { args, driver } = setup({ status: "shortlisted" });
    expect((await rejectionOf(runApplication(args))).code).toBe("invalid-input");
    expect(driver.calls).toEqual([]);
  });

  it("refuses an unknown job", async () => {
    const { args } = setup({ overrides: { jobId: "missing" } });
    expect((await rejectionOf(runApplication(args))).code).toBe("not-found");
  });

  it("refuses a job left in submitting by a crash and never opens the browser (Scenario O)", async () => {
    const { args, driver, jobs } = setup();
    jobs.transition("job-1", "submitting", "simulated crash during the click");
    const error = await rejectionOf(runApplication(args));
    expect(error.code).toBe("unsafe");
    expect(driver.calls).toEqual([]);
    expect(jobs.get("job-1")?.status).toBe("submitting");
  });
});

describe("levels", () => {
  it("Prepare only never touches the driver, even in automatic mode", async () => {
    const { args, driver, jobs } = setup({ level: "prepare" });
    const result = await runApplication(args);
    expect(result.outcome).toBe("staged");
    expect(driver.calls).toEqual([]);
    expect(jobs.get("job-1")?.status).toBe("approved");
  });

  it("Fill I submit fills, reads back, takes a screenshot and never calls submit", async () => {
    const { args, driver, jobs } = setup({ level: "fill" });
    const result = await runApplication(args);
    expect(result.outcome).toBe("filled-for-review");
    expect(result.cleanFill).toBe(true);
    expect(submitCount(driver)).toBe(0);
    expect(driver.calls.some((call) => call.startsWith("fill "))).toBe(true);
    expect(driver.calls.some((call) => call.startsWith("readValue "))).toBe(true);
    expect(driver.calls).toContain("screenshot");
    expect(jobs.get("job-1")?.status).toBe("approved");
    expect(driver.calls.at(-1)).toBe("close");
  });

  it("Automatic submits when the level, the apply mode and the approval all allow it", async () => {
    const { args, driver, jobs } = setup();
    const result = await runApplication(args);
    expect(result.outcome).toBe("applied");
    expect(submitCount(driver)).toBe(1);
    expect(jobs.get("job-1")?.status).toBe("applied");
  });

  it.each([
    [
      "applyMode is approve",
      { settings: settingsWith({ applyMode: "approve", dryRunFirst: false }) },
    ],
    [
      "applyMode is prepare",
      { settings: settingsWith({ applyMode: "prepare", dryRunFirst: false }) },
    ],
    ["the board level is fill", { level: "fill" as BoardLevel }],
    ["the job is not approved yet", { status: "resume-ready" as JobStatus }],
  ])("Automatic behaves as Fill I submit when %s", async (_name, options) => {
    const { args, driver } = setup(options);
    const result = await runApplication(args);
    expect(result.outcome).toBe("filled-for-review");
    expect(submitCount(driver)).toBe(0);
  });

  it("a new board with dryRunFirst gets a dry run and no submit even in Automatic", async () => {
    const { args, driver } = setup({
      settings: settingsWith({ applyMode: "auto", dryRunFirst: true }),
      overrides: { boardHasCleanRun: false },
    });
    const result = await runApplication(args);
    expect(result.outcome).toBe("dry-run-complete");
    expect(submitCount(driver)).toBe(0);
  });

  it("an explicit dry-run mode never submits", async () => {
    const { args, driver } = setup({ overrides: { mode: "dry-run" } });
    expect((await runApplication(args)).outcome).toBe("dry-run-complete");
    expect(submitCount(driver)).toBe(0);
  });
});

describe("blockers and unknown questions", () => {
  it("stops on an unknown required field: job goes to needs-you and no browser opens", async () => {
    const plan = planFor("lever-style", sampleProfile());
    const { args, driver, jobs } = setup({ plan, driver: driverFor("lever-style") });
    const result = await runApplication(args);
    expect(result.outcome).toBe("blocked");
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(driver.calls).toEqual([]);
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });

  it("stops on an unknown legal question with no bank answer", async () => {
    const profile = sampleProfile();
    profile.answerBank = [];
    const plan = planFor("greenhouse-style", profile);
    const { args, driver, jobs } = setup({ plan });
    const result = await runApplication(args);
    expect(result.outcome).toBe("blocked");
    expect(result.blockers.some((blocker) => blocker.label.includes("authorised"))).toBe(true);
    expect(submitCount(driver)).toBe(0);
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });
});

describe("page checks", () => {
  it.each([
    ["a CAPTCHA", { pageText: "Please verify you are human before applying." }],
    [
      "a bot-check widget in the markup",
      {
        html: formHtml("greenhouse-style").replace("<form", '<div class="g-recaptcha"></div><form'),
      },
    ],
    ["a sign-in wall", { pageText: "Please sign in to continue." }],
    [
      "a password field",
      {
        html: formHtml("greenhouse-style").replace(
          "<form",
          '<form><input type="password" name="pw"></form><form',
        ),
      },
    ],
    ["a one-time code", { pageText: "Enter the 6-digit code we sent to your email." }],
    ["an assessment", { pageText: "Please complete the coding assessment on HackerRank." }],
  ])("stops with needs-you on %s and fills nothing", async (_name, options) => {
    const driver = driverFor("greenhouse-style", options);
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("needs-you");
    expect(driver.calls.some((call) => /^(fill|select|upload|submit) /.test(call))).toBe(false);
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });

  it("marks the job closed when the page says it no longer accepts applications", async () => {
    const driver = driverFor("greenhouse-style", {
      pageText: "Sorry, this job is no longer accepting applications.",
    });
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("closed");
    expect(jobs.get("job-1")?.status).toBe("closed");
    expect(submitCount(driver)).toBe(0);
  });

  it("aborts without filling when the live form differs from the saved shape (Scenario P)", async () => {
    const changed = formHtml("greenhouse-style").replace("Submit Application", "Send it now");
    const driver = driverFor("greenhouse-style", { html: changed });
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("needs-you");
    expect(result.reason).toMatch(/different from the one Scout saved/);
    expect(driver.calls.some((call) => /^(fill|select|upload|submit) /.test(call))).toBe(false);
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });

  it("stops with needs-you when the page cannot be opened, and still closes the driver", async () => {
    const driver = driverFor("greenhouse-style", { openThrows: true });
    const { args } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("needs-you");
    expect(driver.calls.at(-1)).toBe("close");
  });
});

describe("two-pass fill", () => {
  it("stops with needs-you and never submits when a read-back value differs", async () => {
    const plan = planFor("greenhouse-style");
    const emailSelector = plan.actions.find((action) => action.type === "email")?.selector ?? "";
    const driver = driverFor("greenhouse-style", {
      corruptions: { [emailSelector]: "alex.rivera@example.co" },
    });
    const { args, jobs } = setup({ driver, plan });
    const result = await runApplication(args);
    expect(result.outcome).toBe("needs-you");
    expect(result.mismatches.map((mismatch) => mismatch.label)).toEqual(["Email"]);
    expect(submitCount(driver)).toBe(0);
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });

  it("reads every field back only after every field was written", async () => {
    const { args, driver } = setup({ level: "fill" });
    await runApplication(args);
    const lastWrite = driver.calls.findLastIndex((call) => /^(fill|select|upload) /.test(call));
    const firstRead = driver.calls.findIndex((call) => call.startsWith("readValue "));
    expect(firstRead).toBeGreaterThan(lastWrite);
  });
});

describe("idempotent submit (Scenario O)", () => {
  it("sets the submitting marker through the job store before the submit call", async () => {
    const { args, driver, jobs } = setup();
    const events: string[] = [];
    let statusAtSubmit: JobStatus | undefined;
    const realTransition = jobs.transition.bind(jobs);
    const spyJobs: JobStore = {
      ...jobs,
      get: (id) => jobs.get(id),
      transition: (id, to, reason) => {
        events.push(`transition:${to}`);
        return realTransition(id, to, reason);
      },
    };
    const realSubmit = driver.submit.bind(driver);
    driver.submit = async (selector) => {
      events.push("submit");
      statusAtSubmit = jobs.get("job-1")?.status;
      await realSubmit(selector);
    };
    await runApplication({ ...args, jobs: spyJobs });
    expect(events.indexOf("transition:submitting")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("transition:submitting")).toBeLessThan(events.indexOf("submit"));
    expect(statusAtSubmit).toBe("submitting");
  });

  it("ends in unverified after a crash during the click and never retries", async () => {
    const driver = driverFor("greenhouse-style", { submitThrows: true });
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("unverified");
    expect(result.submitAttempted).toBe(true);
    expect(submitCount(driver)).toBe(1);
    expect(jobs.get("job-1")?.status).toBe("unverified");
    const again = await rejectionOf(
      runApplication({ ...args, driver: driverFor("greenhouse-style") }),
    );
    expect(again.code).toBe("invalid-input");
  });
});

describe("verification", () => {
  it("marks the job unverified when no confirmation text is seen", async () => {
    const driver = driverFor("greenhouse-style", { confirmationText: "Your session timed out." });
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("unverified");
    expect(jobs.get("job-1")?.status).toBe("unverified");
  });

  it("does not accept a bare thank-you as a confirmation", async () => {
    const driver = driverFor("greenhouse-style", { confirmationText: "Thank you." });
    const { args } = setup({ driver });
    expect((await runApplication(args)).outcome).toBe("unverified");
  });

  it("marks applied only when a confirmation message is seen", async () => {
    const driver = driverFor("greenhouse-style", {
      confirmationText: "We have received your application.",
    });
    const { args, jobs } = setup({ driver });
    const result = await runApplication(args);
    expect(result.outcome).toBe("applied");
    expect(result.confirmationText).toContain("received your application");
    expect(jobs.get("job-1")?.status).toBe("applied");
  });

  it("hands the job to the user when a bot check appears after the submit", async () => {
    const driver = driverFor("greenhouse-style", {
      confirmationText: "Please verify you are human.",
    });
    const { args, jobs } = setup({ driver });
    expect((await runApplication(args)).outcome).toBe("needs-you");
    expect(jobs.get("job-1")?.status).toBe("needs-you");
  });
});

describe("daily limit", () => {
  it("blocks a submit when today's count has reached the limit, before opening the browser", async () => {
    const { args, driver, jobs } = setup({
      settings: settingsWith({ ...AUTO_SETTINGS, dailyApplicationLimit: 3 }),
      overrides: { appliedToday: () => 3 },
    });
    expect((await rejectionOf(runApplication(args))).code).toBe("limit-reached");
    expect(driver.calls).toEqual([]);
    expect(jobs.get("job-1")?.status).toBe("approved");
  });

  it("allows a submit below the limit", async () => {
    const { args } = setup({
      settings: settingsWith({ ...AUTO_SETTINGS, dailyApplicationLimit: 3 }),
      overrides: { appliedToday: () => 2 },
    });
    expect((await runApplication(args)).outcome).toBe("applied");
  });

  it("does not stop a fill-only run, which submits nothing", async () => {
    const { args } = setup({ level: "fill", overrides: { appliedToday: () => 99 } });
    expect((await runApplication(args)).outcome).toBe("filled-for-review");
  });
});

describe("evidence from a run", () => {
  it("saves the pre-submit evidence and then the final one with the confirmation", async () => {
    const folder = makeTemporaryFolder();
    cleanups.push(folder.remove);
    const directory = join(folder.path, "evidence");
    const { args } = setup({ overrides: { evidenceDirectory: directory } });
    await runApplication(args);
    const meta = JSON.parse(readFileSync(join(directory, "evidence.json"), "utf8"));
    expect(meta.outcome).toBe("applied");
    expect(meta.profileVersion).toBe(3);
    expect(existsSync(join(directory, "screenshot-before-submit.png"))).toBe(true);
    expect(readFileSync(join(directory, "confirmation.txt"), "utf8")).toMatch(/received/);
  });

  it("submits nothing when the evidence cannot be saved before the submit", async () => {
    const folder = makeTemporaryFolder();
    cleanups.push(folder.remove);
    const blocker = join(folder.path, "a-file");
    writeFileSync(blocker, "not a folder");
    const { args, driver, jobs } = setup({
      overrides: { evidenceDirectory: join(blocker, "evidence") },
    });
    await expect(runApplication(args)).rejects.toThrow();
    expect(submitCount(driver)).toBe(0);
    expect(jobs.get("job-1")?.status).toBe("approved");
  });
});

describe("property: submit is only ever called when every rule allows it", () => {
  const levels: BoardLevel[] = ["prepare", "fill", "auto"];
  const applyModes: Settings["applyMode"][] = ["approve", "auto", "prepare"];
  const statuses: JobStatus[] = ["resume-ready", "approved"];
  const booleans = [false, true];

  it("holds across every combination of level, mode, status, dry-run, clean record and pause", async () => {
    let submits = 0;
    for (const level of levels)
      for (const applyMode of applyModes)
        for (const status of statuses)
          for (const dryRunFirst of booleans)
            for (const boardHasCleanRun of booleans)
              for (const dryRunMode of booleans)
                for (const paused of booleans) {
                  const { args, driver } = setup({
                    level,
                    status,
                    settings: settingsWith({ applyMode, dryRunFirst, automationPaused: paused }),
                    overrides: { boardHasCleanRun, mode: dryRunMode ? "dry-run" : "live" },
                  });
                  try {
                    await runApplication(args);
                  } catch (error) {
                    expect(error).toBeInstanceOf(ScoutError);
                  }
                  const dryRun = dryRunMode || (dryRunFirst && !boardHasCleanRun);
                  const allowed =
                    !paused &&
                    !dryRun &&
                    level === "auto" &&
                    applyMode === "auto" &&
                    status === "approved";
                  expect(submitCount(driver)).toBe(allowed ? 1 : 0);
                  expect(mayAutoSubmit({ dryRun, level, applyMode, jobStatus: status })).toBe(
                    !dryRun && level === "auto" && applyMode === "auto" && status === "approved",
                  );
                  if (level === "prepare" || paused) expect(driver.calls).toEqual([]);
                  submits += submitCount(driver);
                }
    expect(submits).toBeGreaterThan(0);
  });
});
