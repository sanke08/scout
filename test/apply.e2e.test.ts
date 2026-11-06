/**
 * End-to-end tests of `scout approve`, `skip`, `undo`, `apply` and `apply self-test`, through the
 * real `main(argv, overrides)` with the apply module's fake browser on saved fictional forms.
 *
 * What must stay true: nothing is submitted without the typed yes at level Automatic; a paused
 * Scout, a reached limit or a missing LaTeX stops everything before a page opens; an interrupted
 * submit is never retried; the real browser is never started.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePosting, profileForGreenhouse, sampleProfile } from "../src/apply/test-helpers.js";
import { makeApplyWorld, type ApplyWorld, type ApplyWorldOptions } from "./apply-helpers.js";
import { FIXED_NOW } from "./helpers.js";

const worlds: ApplyWorld[] = [];
afterEach(() => {
  while (worlds.length > 0) worlds.pop()?.remove();
});

/** Makes a world that is removed after the test. */
function world(options: ApplyWorldOptions = {}): ApplyWorld {
  const made = makeApplyWorld(options);
  worlds.push(made);
  return made;
}

/** The status of the one test job. */
function statusOf(made: ApplyWorld): string | undefined {
  return made.inspect((application) => application.jobStore.get("job-1")?.status);
}

/** Settings that let level Automatic submit once the user types yes. */
const AUTO_SETTINGS = {
  boardLevels: { greenhouse: "auto" as const },
  applyMode: "auto" as const,
  dryRunFirst: false,
};

/** The calls that would change the page or send something. */
function touchingCalls(made: ApplyWorld): string[] {
  return made.driver.calls.filter((call) => /^(fill|select|upload|submit) /.test(call));
}

/** Every line a run printed, as one text. */
function allOutput(result: { lines: string[]; errors: string[] }): string {
  return [...result.lines, ...result.errors].join("\n");
}

describe("scout approve, skip and undo", () => {
  it("approves a resume-ready job without submitting anything", async () => {
    const made = world();
    const result = await made.run(["approve", "job-1"]);
    expect(result.exitCode).toBe(0);
    expect(statusOf(made)).toBe("approved");
    expect(allOutput(result)).toMatch(/Nothing was submitted/);
    expect(made.browserOpens).toHaveLength(0);
  });

  it("gives the store's full sentence for a move that is not allowed, and changes nothing", async () => {
    const made = world({ jobStatus: "shortlisted" });
    const result = await made.run(["approve", "job-1"]);
    expect(result.exitCode).toBe(4);
    expect(allOutput(result)).toMatch(/cannot move from shortlisted to approved/);
    expect(statusOf(made)).toBe("shortlisted");
  });

  it("reports an unknown job with the not-found exit code", async () => {
    const result = await world().run(["approve", "no-such-job"]);
    expect(result.exitCode).toBe(3);
    expect(allOutput(result)).toMatch(/No job with id no-such-job/);
  });

  it("skips with a tag as the recorded reason, and refuses an unknown tag", async () => {
    const made = world();
    const refused = await made.run(["skip", "job-1", "--tag", "Because I said so"]);
    expect(refused.exitCode).toBe(2);
    expect(statusOf(made)).toBe("resume-ready");

    const result = await made.run(["skip", "job-1", "--tag", "Too junior"]);
    expect(result.exitCode).toBe(0);
    const job = made.inspect((application) => application.jobStore.get("job-1"));
    expect(job?.status).toBe("skipped");
    expect(job?.statusReason).toBe("Too junior");
  });

  it("never skips a job that was already submitted (D-007)", async () => {
    const made = world({ jobStatus: "applied" });
    const result = await made.run(["skip", "job-1"]);
    expect(result.exitCode).toBe(4);
    expect(statusOf(made)).toBe("applied");
  });

  it("undoes an approval and a skip with the store's reverse moves", async () => {
    const made = world({ jobStatus: "approved" });
    await made.run(["undo", "job-1"]);
    expect(statusOf(made)).toBe("resume-ready");
    await made.run(["skip", "job-1"]);
    await made.run(["undo", "job-1"]);
    expect(statusOf(made)).toBe("found");
  });

  it("returns a job that needed you to where it came from", async () => {
    const made = world({ jobStatus: "needs-you" });
    const result = await made.run(["undo", "job-1"]);
    expect(result.exitCode).toBe(0);
    expect(statusOf(made)).toBe("approved");
  });

  it("refuses to undo a submitted job", async () => {
    const made = world({ jobStatus: "applied" });
    const result = await made.run(["undo", "job-1"]);
    expect(result.exitCode).toBe(4);
    expect(statusOf(made)).toBe("applied");
  });
});

describe("scout apply at level Prepare only", () => {
  it("never opens the browser, fills nothing and leaves the job as it was", async () => {
    const made = world({ jobStatus: "approved" });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(0);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.driver.calls).toEqual([]);
    expect(statusOf(made)).toBe("approved");
    expect(allOutput(result)).toMatch(/Prepare only/);
    expect(allOutput(result)).toMatch(/Ready to fill/);
  });

  it("still lists what the user must answer, and moves the job to needs-you", async () => {
    const made = world({ form: "lever-style", profile: sampleProfile() });
    const result = await made.run(["apply", "job-1"]);
    expect(made.browserOpens).toHaveLength(0);
    expect(allOutput(result)).toMatch(/Are you open to relocating to Berlin/);
    expect(statusOf(made)).toBe("needs-you");
  });

  it("stages the job when the form cannot be read without a browser", async () => {
    const made = world();
    const result = await made.run(["apply", "job-1"], {
      apply: {
        ...made.overrides().apply,
        readFormPage: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(allOutput(result)).toMatch(/could not read the form without a browser/);
    expect(made.browserOpens).toHaveLength(0);
  });
});

describe("scout apply at level Fill, I submit", () => {
  const FILL = { boardLevels: { greenhouse: "fill" as const }, dryRunFirst: false };

  it("fills in a visible browser, shows the plan, and never submits", async () => {
    const made = world({ settings: FILL });
    const result = await made.run(["apply", "job-1", "--wait", "0"]);
    expect(result.exitCode).toBe(0);
    expect(made.browserOpens).toHaveLength(1);
    expect(made.browserOpens[0]?.headless).toBe(false);
    expect(made.browserOpens[0]?.profileDirectory).toBe(join(made.directory, "browser-profile"));
    expect(touchingCalls(made).some((call) => call.startsWith("fill "))).toBe(true);
    expect(touchingCalls(made).some((call) => call.startsWith("submit "))).toBe(false);
    expect(made.prompts).toHaveLength(0);
    const text = allOutput(result);
    expect(text).toMatch(/Ready to fill/);
    expect(text).toMatch(/Needs you \(0\)/);
    expect(text).toMatch(/Level: Fill, I submit/);
    expect(statusOf(made)).toBe("resume-ready");
    expect(existsSync(join(made.evidenceDirectory, "evidence.json"))).toBe(true);
  });

  it("records applied only when the page shows a confirmation after the user's own submit", async () => {
    const made = world({
      settings: FILL,
      wrapDriver: (driver) => ({
        ...driver,
        readConfirmation: async () => "Thank you for applying! Your application has been received.",
      }),
    });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(0);
    expect(statusOf(made)).toBe("applied");
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    const confirmation = readFileSync(join(made.evidenceDirectory, "confirmation.txt"), "utf8");
    expect(confirmation).toMatch(/Thank you for applying/);
    expect(existsSync(join(made.evidenceDirectory, "screenshot-before-submit.png"))).toBe(true);
  });

  it("records unverified, not applied, when no confirmation is seen in time", async () => {
    const made = world({ settings: FILL });
    const result = await made.run(["apply", "job-1", "--wait", "1"]);
    expect(result.exitCode).toBe(0);
    expect(statusOf(made)).toBe("unverified");
    expect(allOutput(result)).toMatch(/unverified/);
  });

  it("is a dry run on a board with no clean run, and records the clean run", async () => {
    const made = world({ settings: { ...FILL, dryRunFirst: true } });
    const result = await made.run(["apply", "job-1"]);
    expect(allOutput(result)).toMatch(/dry run/);
    expect(statusOf(made)).toBe("resume-ready");
    const record = JSON.parse(readFileSync(join(made.directory, "board-runs.json"), "utf8"));
    expect(record.boards.greenhouse.cleanDryRuns).toBe(1);
  });

  it("counts a clean run only for dry runs: a plain fill run adds nothing", async () => {
    const made = world({ settings: FILL });
    await made.run(["apply", "job-1", "--wait", "0"]);
    expect(existsSync(join(made.directory, "board-runs.json"))).toBe(false);
    await made.run(["apply", "job-1", "--dry-run"]);
    const record = JSON.parse(readFileSync(join(made.directory, "board-runs.json"), "utf8"));
    expect(record.boards.greenhouse.cleanDryRuns).toBe(1);
  });

  it("stops with needs-you and lists the questions when a required field is unknown", async () => {
    const made = world({ settings: FILL, form: "lever-style", profile: sampleProfile() });
    const result = await made.run(["apply", "job-1"]);
    expect(allOutput(result)).toMatch(/Needs you \(1\)/);
    expect(allOutput(result)).toMatch(/Are you open to relocating to Berlin/);
    expect(statusOf(made)).toBe("needs-you");
    expect(touchingCalls(made)).toEqual([]);
  });

  it("stops at a sign-in wall, never types a password, and tells the user to sign in themselves", async () => {
    const made = world({
      settings: FILL,
      typedLines: [""],
      wrapDriver: (driver) => ({
        ...driver,
        pageText: async () => "Please sign in to continue to your account.",
      }),
    });
    const result = await made.run(["apply", "job-1"]);
    expect(statusOf(made)).toBe("needs-you");
    expect(allOutput(result)).toMatch(/Sign in yourself in the open browser window/);
    expect(touchingCalls(made)).toEqual([]);
    expect(made.prompts[0]).toMatch(/scout undo job-1/);
  });
});

describe("scout apply at level Automatic", () => {
  it("behaves as Fill, I submit unless the apply mode, the board level and the approval all agree", async () => {
    const cases: {
      name: string;
      settings: ApplyWorldOptions["settings"];
      jobStatus: "approved" | "resume-ready";
    }[] = [
      {
        name: "apply mode is approve",
        settings: { ...AUTO_SETTINGS, applyMode: "approve" },
        jobStatus: "approved",
      },
      {
        name: "board level is fill",
        settings: { ...AUTO_SETTINGS, boardLevels: { greenhouse: "fill" } },
        jobStatus: "approved",
      },
      { name: "job is not approved", settings: AUTO_SETTINGS, jobStatus: "resume-ready" },
      {
        name: "board is new and dry run first is on",
        settings: { ...AUTO_SETTINGS, dryRunFirst: true },
        jobStatus: "approved",
      },
    ];
    for (const { name, settings, jobStatus } of cases) {
      const made = world({ settings, jobStatus, typedLines: ["yes"] });
      const result = await made.run(["apply", "job-1", "--wait", "0"]);
      expect(result.exitCode, name).toBe(0);
      expect(made.prompts, name).toHaveLength(0);
      expect(
        made.driver.calls.some((call) => call.startsWith("submit ")),
        name,
      ).toBe(false);
      expect(statusOf(made), name).toBe(jobStatus);
    }
  });

  it("is held back to Fill when the board's latest self-test failed", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved", typedLines: ["yes"] });
    writeBoardRuns(made.directory, {
      greenhouse: { cleanDryRuns: 2, lastFailedAt: FIXED_NOW.toISOString() },
    });
    const result = await made.run(["apply", "job-1", "--wait", "0"]);
    expect(allOutput(result)).toMatch(/latest self-test failed/);
    expect(made.prompts).toHaveLength(0);
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
  });

  it("shows the exact summary and does not submit unless exactly yes is typed", async () => {
    for (const typed of ["", "no", "y", "yes please"]) {
      const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved", typedLines: [typed] });
      const result = await made.run(["apply", "job-1", "--wait", "0"]);
      expect(made.prompts, typed).toHaveLength(1);
      expect(allOutput(result)).toMatch(/This is exactly what Scout will submit/);
      expect(allOutput(result)).toMatch(/Email: alex\.rivera@example\.com/);
      expect(
        made.driver.calls.some((call) => call.startsWith("submit ")),
        typed,
      ).toBe(false);
      expect(statusOf(made), typed).toBe("approved");
    }
  });

  it("submits once, records applied with the confirmation as evidence, after a typed yes", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved", typedLines: ["yes"] });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(0);
    expect(made.driver.calls.filter((call) => call.startsWith("submit "))).toHaveLength(1);
    expect(statusOf(made)).toBe("applied");
    expect(readFileSync(join(made.evidenceDirectory, "confirmation.txt"), "utf8")).toMatch(
      /Thank you for applying/,
    );
  });

  it("never retries a submit that crashed: the job is unverified and a second run opens nothing", async () => {
    const made = world({
      settings: AUTO_SETTINGS,
      jobStatus: "approved",
      typedLines: ["yes", "yes"],
      submitThrows: true,
    });
    await made.run(["apply", "job-1"]);
    expect(statusOf(made)).toBe("unverified");
    const opensBefore = made.browserOpens.length;
    const again = await made.run(["apply", "job-1"]);
    expect(again.exitCode).not.toBe(0);
    expect(made.browserOpens).toHaveLength(opensBefore);
    expect(made.driver.calls.filter((call) => call.startsWith("submit "))).toHaveLength(1);
  });

  it("refuses a job left in submitting by a crash, before opening anything", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "submitting", typedLines: ["yes"] });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(8);
    expect(allOutput(result)).toMatch(/never retries a submit blindly/);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.prompts).toHaveLength(0);
  });

  it("stops at the daily limit before opening a page or asking", async () => {
    const made = world({
      settings: { ...AUTO_SETTINGS, dailyApplicationLimit: 1 },
      jobStatus: "approved",
      typedLines: ["yes"],
    });
    made.inspect((application) => {
      application.jobStore.upsertPosting(otherPosting());
      for (const step of [
        "shortlisted",
        "resume-ready",
        "approved",
        "submitting",
        "applied",
      ] as const) {
        application.jobStore.transition("job-2", step, "test setup");
      }
    });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(5);
    expect(allOutput(result)).toMatch(/limit of 1 applications/);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.prompts).toHaveLength(0);
    expect(statusOf(made)).toBe("approved");
  });
});

describe("scout apply stops before doing anything", () => {
  it("refuses while the kill switch is on, before building a resume, downloading or opening a page", async () => {
    const made = world({
      settings: { ...AUTO_SETTINGS, automationPaused: true },
      jobStatus: "approved",
      seedResume: false,
    });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(7);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.pageDownloads).toHaveLength(0);
    expect(made.compileCount()).toBe(0);
    expect(made.prompts).toHaveLength(0);
    expect(statusOf(made)).toBe("approved");
  });

  it("says plainly that pdflatex is missing and stops, with the job untouched", async () => {
    const made = world({
      settings: { boardLevels: { greenhouse: "fill" } },
      seedResume: false,
      compileFailure: "The pdflatex program was not found. Install a LaTeX distribution.",
    });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(6);
    expect(allOutput(result)).toMatch(/pdflatex program was not found/);
    expect(made.browserOpens).toHaveLength(0);
    expect(statusOf(made)).toBe("resume-ready");
  });

  it("builds and compiles a resume into the data folder when the job folder has none", async () => {
    const made = world({
      settings: { boardLevels: { greenhouse: "fill" }, dryRunFirst: false },
      seedResume: false,
    });
    const result = await made.run(["apply", "job-1", "--wait", "0"]);
    expect(result.exitCode).toBe(0);
    expect(made.compileCount()).toBe(1);
    expect(readdirSync(join(made.directory, "resumes")).some((name) => name.endsWith(".pdf"))).toBe(
      true,
    );
    expect(allOutput(result)).toMatch(/Resume: .*resumes/);
  });

  it("refuses a job that is not resume-ready or approved", async () => {
    const made = world({ jobStatus: "shortlisted" });
    const result = await made.run(["apply", "job-1"]);
    expect(result.exitCode).toBe(2);
    expect(made.browserOpens).toHaveLength(0);
  });

  it("opens only the page it was given with --url, and only http or https", async () => {
    const made = world({ settings: { boardLevels: { greenhouse: "fill" }, dryRunFirst: false } });
    await made.run(["apply", "job-1", "--wait", "0", "--url", "https://example.com/jobs/1/apply"]);
    expect(made.driver.calls).toContain("open https://example.com/jobs/1/apply");
    const refused = await made.run(["apply", "job-1", "--url", "file:///etc/passwd"]);
    expect(refused.exitCode).toBe(2);
  });

  it("uses the profile folder it was given", async () => {
    const made = world({ settings: { boardLevels: { greenhouse: "fill" }, dryRunFirst: false } });
    await made.run([
      "apply",
      "job-1",
      "--wait",
      "0",
      "--profile-dir",
      join(made.directory, "other-profile"),
    ]);
    expect(made.browserOpens[0]?.profileDirectory).toBe(join(made.directory, "other-profile"));
  });
});

describe("scout apply self-test", () => {
  /** A test profile file that answers every required question of the Greenhouse-style form. */
  function testProfileFile(made: ApplyWorld): string {
    return join(made.directory, "test-profile.json");
  }

  it("passes on a stable form, never submits, and counts one clean run", async () => {
    const made = world();
    writeTestProfile(testProfileFile(made));
    writePdfIntoResumes(made.directory);
    const result = await made.run([
      "apply",
      "self-test",
      "fixtures/forms/greenhouse-style.html",
      "--profile-file",
      testProfileFile(made),
    ]);
    expect(result.exitCode).toBe(0);
    expect(allOutput(result)).toMatch(/Self-test passed for greenhouse/);
    expect(made.browserOpens[0]?.headless).toBe(true);
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    const record = JSON.parse(readFileSync(join(made.directory, "board-runs.json"), "utf8"));
    expect(record.boards.greenhouse.cleanDryRuns).toBe(1);
  });

  it("fails when the form's shape changed and holds the board back from Automatic", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved", typedLines: ["yes"] });
    writeTestProfile(testProfileFile(made));
    writePdfIntoResumes(made.directory);
    const failed = await made.run([
      "apply",
      "self-test",
      "fixtures/forms/greenhouse-style.html",
      "--profile-file",
      testProfileFile(made),
      "--expected-shape",
      "0000000000000000",
    ]);
    expect(allOutput(failed)).toMatch(/Self-test FAILED for greenhouse/);
    const record = JSON.parse(readFileSync(join(made.directory, "board-runs.json"), "utf8"));
    expect(record.boards.greenhouse.lastFailedAt).toBeDefined();

    const later = await made.run(["apply", "job-1", "--wait", "0"]);
    expect(allOutput(later)).toMatch(/latest self-test failed/);
    expect(made.prompts).toHaveLength(0);
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
  });

  it("asks for --board when the board cannot be told from the target", async () => {
    const made = world();
    const result = await made.run(["apply", "self-test", "https://example.com/stable-posting"]);
    expect(result.exitCode).toBe(2);
    expect(allOutput(result)).toMatch(/--board/);
    expect(made.browserOpens).toHaveLength(0);
  });

  it("refuses while the kill switch is on", async () => {
    const made = world({ settings: { automationPaused: true } });
    const result = await made.run(["apply", "self-test", "fixtures/forms/greenhouse-style.html"]);
    expect(result.exitCode).toBe(7);
    expect(made.browserOpens).toHaveLength(0);
  });
});

describe("safety properties", () => {
  it("has no flag that answers the final confirmation for the user", async () => {
    const commandsFolder = new URL("../src/app/commands/", import.meta.url);
    const sources = readdirSync(commandsFolder).filter((name) => /^apply-.*\.ts$/.test(name));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const text = readFileSync(new URL(name, commandsFolder), "utf8");
      expect(text, name).not.toMatch(/assume[-_ ]?yes/i);
      expect(text, name).not.toMatch(/--yes\b|--force\b|--confirm\b/);
    }
  });

  it("rejects such a flag at run time and does nothing", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved" });
    const result = await made.run(["apply", "job-1", "--assume-yes"]);
    expect(result.exitCode).not.toBe(0);
    expect(made.browserOpens).toHaveLength(0);
    expect(statusOf(made)).toBe("approved");
  });

  it("never prints a password-like value or fills a password field, in any run", async () => {
    const made = world({ settings: AUTO_SETTINGS, jobStatus: "approved", typedLines: ["yes"] });
    const result = await made.run(["apply", "job-1"]);
    expect(allOutput(result)).not.toMatch(/password|passwd|secret|token/i);
    expect(made.driver.calls.some((call) => /password/i.test(call))).toBe(false);
  });

  it("routes `apply self-test` to the self-test and `apply <id>` to the application", async () => {
    const made = world();
    const selfTest = await made.run(["apply", "self-test", "https://example.com/stable-posting"]);
    expect(allOutput(selfTest)).toMatch(/--board/);
    const application = await made.run(["apply", "job-1"]);
    expect(allOutput(application)).toMatch(/Applying to ExampleCorp/);
  });
});

/** Writes the Greenhouse-ready test profile as a file the self-test can read. */
function writeTestProfile(path: string): void {
  writeFileSync(path, JSON.stringify(profileForGreenhouse(), null, 2));
}

/** Puts a fictional PDF in the data folder's resumes folder, for the form's resume field. */
function writePdfIntoResumes(directory: string): void {
  mkdirSync(join(directory, "resumes"), { recursive: true });
  writeFileSync(join(directory, "resumes", "Alex_Rivera_Test.pdf"), "%PDF-1.4 fictional");
}

/** Writes `board-runs.json` the way the app does, to set up a board's record. */
function writeBoardRuns(directory: string, boards: Record<string, object>): void {
  writeFileSync(join(directory, "board-runs.json"), JSON.stringify({ schemaVersion: 1, boards }));
}

/** A second fictional job, used to fill today's application count. */
function otherPosting() {
  return {
    ...makePosting(),
    id: "job-2",
    company: "OtherCorp",
    canonicalUrl: "https://example.com/jobs/2",
    sources: [{ name: "greenhouse:othercorp", url: "https://example.com/jobs/2" }],
  };
}
