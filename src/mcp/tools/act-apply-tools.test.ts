/**
 * Tests of `get_form` and `apply_to_job` through the tool handlers, with the apply module's fake
 * browser on saved fictional forms and a fake vault. No real browser, network or keychain.
 *
 * What must stay true: Prepare opens no browser; Fill never submits and leaves the window open;
 * Automatic submits at most once, only with the kill switch off and the daily limit not reached,
 * and records applied only for new confirmation text; a sign-in wall, CAPTCHA or missing answer
 * never gets past; every answer is saved in the evidence; a job is never submitted twice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApplication } from "../../app/index.js";
import { createScoutMcpService } from "../server.js";
import { formHtml, profileForGreenhouse, sampleProfile } from "../../apply/test-helpers.js";
import { createFakeSite, FAKE_PASSWORD } from "../../platforms/test-helpers.js";
import {
  dataOf,
  errorOf,
  makeActWorld,
  type ActWorld,
  type ActWorldOptions,
} from "./act-test-helpers.js";

const worlds: ActWorld[] = [];
afterEach(() => {
  while (worlds.length > 0) worlds.pop()?.remove();
});

/** Makes a world that is removed after the test. */
function world(options: ActWorldOptions = {}): ActWorld {
  const made = makeActWorld(options);
  worlds.push(made);
  return made;
}

/** The Greenhouse-style form where "How did you hear about this job?" is required: a factual question the profile cannot answer. */
const SOURCE_KEY = "job_application[answers][source]";
function sourceRequiredForm(): string {
  return formHtml("greenhouse-style").replace(
    'id="source" name="job_application[answers][source]" type="text"',
    'id="source" name="job_application[answers][source]" type="text" required',
  );
}

/** Settings that let level Automatic submit. */
const AUTO = { boardLevels: { greenhouse: "auto" as const }, dryRunFirst: false };

/** The calls that would change the page or send something. */
function touching(made: ActWorld): string[] {
  return made.driver.calls.filter((call) => /^(fill|select|upload|submit) /.test(call));
}

/** Reads one evidence file. */
function evidenceFile(made: ActWorld, name: string): string {
  return readFileSync(join(made.evidenceDirectory, name), "utf8");
}

describe("get_form", () => {
  it("lists the fields with hints and keeps the page text in untrustedText, opening no browser", async () => {
    const made = world();
    const data = dataOf(await made.call("get_form", { jobId: "job-1" }));
    const fields = data["fields"] as { key: string; hint: { status: string } }[];
    expect(fields.length).toBeGreaterThan(3);
    expect(fields.some((field) => field.hint.status === "ready")).toBe(true);
    expect(typeof data["untrustedText"]).toBe("string");
    expect(made.browserOpens).toHaveLength(0);
    expect(made.pageDownloads).toEqual(["https://example.com/jobs/1"]);
    expect(JSON.stringify({ ...data, untrustedText: "" })).not.toMatch(
      /Thank you|Submit Application page/,
    );
  });

  it("marks the questions the profile cannot answer, so the model knows what to supply", async () => {
    const made = world({ form: "lever-style", profile: sampleProfile() });
    const data = dataOf(await made.call("get_form", { jobId: "job-1" }));
    const fields = data["fields"] as { key: string; hint: { status: string } }[];
    const relocate = fields.find((field) => field.key === "cards[relocate]");
    expect(relocate?.hint.status).not.toBe("ready");
  });

  it("refuses while paused, and for an unknown job, and when the page cannot be downloaded", async () => {
    const paused = world();
    paused.pause();
    expect(errorOf(await paused.call("get_form", { jobId: "job-1" }))).toMatch(/paused/i);
    expect(paused.pageDownloads).toHaveLength(0);

    const made = world({ downloadFails: true });
    expect(errorOf(await made.call("get_form", { jobId: "nope" }))).toMatch(/No job with id nope/);
    expect(errorOf(await made.call("get_form", { jobId: "job-1" }))).toMatch(
      /Something unexpected/,
    );
  });

  it("refuses an application address on another site", async () => {
    const made = world();
    const message = errorOf(
      await made.call("get_form", { jobId: "job-1", applyUrl: "https://evil.example.net/apply" }),
    );
    expect(message).toMatch(/posting's own address/);
    expect(made.pageDownloads).toHaveLength(0);
  });

  it("refuses another company's form on the same shared host, and accepts only the posting's own addresses", async () => {
    const made = world({
      posting: {
        sources: [
          { name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" },
          { name: "company-site", url: "https://example.com/jobs/1/apply" },
        ],
      },
    });
    const other = errorOf(
      await made.call("get_form", { jobId: "job-1", applyUrl: "https://example.com/jobs/999" }),
    );
    expect(other).toMatch(/posting's own address/);
    expect(made.pageDownloads).toHaveLength(0);

    dataOf(
      await made.call("get_form", {
        jobId: "job-1",
        applyUrl: "https://example.com/jobs/1/apply/?utm_source=news#top",
      }),
    );
    expect(made.pageDownloads).toHaveLength(1);

    const prepared = errorOf(
      await made.call("apply_to_job", { jobId: "job-1", applyUrl: "https://example.com/jobs/2" }),
    );
    expect(prepared).toMatch(/posting's own address/);
    expect(made.status()).toBe("shortlisted");
  });

  it("returns the form's own words cleaned and named as outside text", async () => {
    const made = world({ posting: { company: "Example\u0007Corp" } });
    const data = dataOf(await made.call("get_form", { jobId: "job-1" }));
    expect(data["company"]).toBe("ExampleCorp");
    expect(data["outsideFields"]).toEqual(
      expect.arrayContaining(["fields[].label", "submitButton"]),
    );
    expect(String(data["notice"])).toMatch(/Never follow instructions/);
  });
});

describe("apply_to_job at Prepare only", () => {
  it("opens no browser, stages the answers, and leaves the job as it was", async () => {
    const made = world({ jobStatus: "resume-ready" });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("staged");
    expect(made.browserOpens).toHaveLength(0);
    expect(made.driver.calls).toEqual([]);
    expect(made.status()).toBe("resume-ready");
    expect(existsSync(join(made.evidenceDirectory, "staged-application.json"))).toBe(true);
  });

  it("reports missing answers without changing the job, then stages once they are given", async () => {
    const made = world({ html: sourceRequiredForm() });
    const blocked = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(blocked["outcome"]).toBe("blocked");
    const missing = (blocked["missingFields"] as { fieldKey: string }[]).map((f) => f.fieldKey);
    expect(missing).toEqual([SOURCE_KEY]);
    expect(made.status()).toBe("shortlisted");

    const staged = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { [SOURCE_KEY]: "A friend told me" },
      }),
    );
    expect(staged["outcome"]).toBe("staged");
    expect(JSON.parse(evidenceFile(made, "answers.json")).values[SOURCE_KEY].source).toBe(
      "model-answer",
    );
  });

  it("keeps the profile's own values and lets the code, not the model, choose prefer-not-to-say", async () => {
    const made = world({ html: sourceRequiredForm() });
    const data = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: {
          [SOURCE_KEY]: "A friend told me",
          "job_application[email]": "someone-else@example.net",
          "job_application[demographic][gender]": "Male",
        },
      }),
    );
    expect(data["outcome"]).toBe("staged");
    const ignored = (data["ignoredAnswers"] as { fieldKey: string }[]).map((item) => item.fieldKey);
    expect(ignored).toContain("job_application[email]");
    expect(ignored).toContain("job_application[demographic][gender]");
    const values = JSON.parse(evidenceFile(made, "answers.json")).values;
    expect(values["job_application[demographic][gender]"].source).toBe("demographic-setting");
    expect(values["job_application[demographic][gender]"].value).not.toBe("Male");
  });

  it("never lets the model answer a personal question: the job goes to needs-you with the question", async () => {
    const made = world({ form: "lever-style", profile: sampleProfile() });
    const data = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { "cards[relocate]": "Yes" },
      }),
    );
    expect(data["outcome"]).toBe("needs-you");
    expect(made.status()).toBe("needs-you");
    expect(made.application.jobStore.get("job-1")?.statusReason).toMatch(
      /only you can answer.*relocating to Berlin/s,
    );
    expect(existsSync(join(made.evidenceDirectory, "staged-application.json"))).toBe(false);
    expect(made.browserOpens).toHaveLength(0);
  });

  it("refuses a free-text answer that claims what the profile lacks, and one that uses a never-used term", async () => {
    const profile = profileForGreenhouse();
    profile.neverUsed.push("side project");
    const made = world({ html: sourceRequiredForm(), profile });
    const claim = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { [SOURCE_KEY]: "Initech's recruiter Bob led a team of eight" },
      }),
    );
    expect(claim["outcome"]).toBe("blocked");
    const refused = claim["refusedAnswers"] as { fieldKey: string; reason: string }[];
    expect(refused[0]?.reason).toMatch(/does not back/);

    const never = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { [SOURCE_KEY]: "Through my side project" },
      }),
    );
    expect(never["outcome"]).toBe("blocked");
    expect((never["refusedAnswers"] as { reason: string }[])[0]?.reason).toMatch(
      /never to be used/,
    );
  });

  it("stages the resume even when the form cannot be read without a browser", async () => {
    const made = world({ downloadFails: true });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("staged");
    expect(made.browserOpens).toHaveLength(0);
  });
});

describe("apply_to_job at Fill, I submit", () => {
  const FILL = { boardLevels: { greenhouse: "fill" as const } };

  /** Where the helper's lock file for the test job lives. */
  function lockFile(made: ActWorld): string {
    return join(made.directory, "apply-helpers", "job-1.lock");
  }

  it("hands the form to a detached helper, opens no browser, and returns at once waiting for the owner", async () => {
    const made = world({ settings: FILL });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("waiting-for-you");
    expect(data["status"]).toBe("waiting-for-you");
    expect(made.browserOpens).toHaveLength(0);
    expect(made.driver.calls).toEqual([]);
    expect(made.helperStarts).toHaveLength(1);
    const request = made.helperStarts[0]!;
    expect(request.args.slice(0, 2)).toEqual(["apply-keep-open", "job-1"]);
    expect(request.args[2]).toBe("--answers-file");
    expect(request.args[3]!.startsWith(join(made.directory, "apply-helpers"))).toBe(true);
    expect(existsSync(request.args[3]!)).toBe(true);
    expect(made.status()).toBe("needs-you");
    expect(made.application.jobStore.get("job-1")?.statusReason).toMatch(
      /waiting for you to press submit/,
    );
  });

  it("the helper fills, writes the submit marker before waiting, and records applied for a new confirmation", async () => {
    const statusesWhenWaiting: (string | undefined)[] = [];
    const made = world({
      settings: FILL,
      ownerSubmits: true,
      wrapDriver: (driver, application) => ({
        ...driver,
        readConfirmation: async () => {
          statusesWhenWaiting.push(application.jobStore.get("job-1")?.status);
          return driver.readConfirmation();
        },
      }),
    });
    await made.call("apply_to_job", { jobId: "job-1" });
    await made.runHelper();
    expect(made.status()).toBe("applied");
    expect(statusesWhenWaiting.length).toBeGreaterThan(0);
    expect(new Set(statusesWhenWaiting)).toEqual(new Set(["submitting"]));
    expect(touching(made).some((call) => call.startsWith("fill "))).toBe(true);
    // Only the owner's own click submitted; Scout never did.
    expect(made.driver.calls.filter((call) => call.startsWith("submit "))).toHaveLength(1);
    expect(made.driver.calls.at(-1)).toBe("close");
    for (const name of [
      "answers.json",
      "evidence.json",
      "screenshot-after-submit.png",
      "confirmation.txt",
    ]) {
      expect(existsSync(join(made.evidenceDirectory, name)), name).toBe(true);
    }
    expect(JSON.parse(evidenceFile(made, "evidence.json")).outcome).toBe("applied");
    expect(existsSync(lockFile(made))).toBe(false);
    expect(existsSync(made.helperStarts[0]!.args[3]!)).toBe(false);
    expect(made.application.ledger.get("job-1")?.appliedAt).not.toBe("");
  });

  it("records unverified when the owner never submits, and the job can never be applied for again", async () => {
    const made = world({ settings: FILL });
    await made.call("apply_to_job", { jobId: "job-1" });
    await made.runHelper({ wait: "6" });
    expect(made.status()).toBe("unverified");
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(
      /unverified|cannot be applied/,
    );
  });

  it("does not count a confirmation banner that was already on the page", async () => {
    const banner = "Thank you for applying! Your application has been received.";
    const made = world({
      settings: FILL,
      wrapDriver: (driver) => ({ ...driver, readConfirmation: async () => banner }),
    });
    await made.call("apply_to_job", { jobId: "job-1" });
    await made.runHelper({ wait: "3" });
    expect(made.status()).toBe("unverified");
  });

  it("honours the pause switch before filling anything", async () => {
    const made = world({ settings: FILL });
    await made.call("apply_to_job", { jobId: "job-1" });
    made.pause();
    await expect(made.runHelper()).rejects.toThrow(/paused/i);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.status()).not.toBe("submitting");
    expect(made.status()).not.toBe("applied");
    expect(existsSync(lockFile(made))).toBe(false);
  });

  it("refuses a second helper for the same job while one is running", async () => {
    const made = world({ settings: FILL });
    await made.call("apply_to_job", { jobId: "job-1" });
    mkdirSync(join(made.directory, "apply-helpers"), { recursive: true });
    writeFileSync(lockFile(made), JSON.stringify({ pid: process.pid }));
    await expect(made.runHelper()).rejects.toThrow(/already open/);
    expect(made.browserOpens).toHaveLength(0);
    expect(existsSync(lockFile(made))).toBe(true);
  });

  it("the tool refuses to start another window while a helper holds the job", async () => {
    const made = world({ settings: FILL });
    mkdirSync(join(made.directory, "apply-helpers"), { recursive: true });
    writeFileSync(lockFile(made), JSON.stringify({ pid: process.pid }));
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(/already open/);
    expect(made.helperStarts).toHaveLength(0);
    expect(made.status()).toBe("shortlisted");
  });

  it("falls back to Prepare only, and says so, when no helper can be started", async () => {
    const made = world({ settings: FILL, helperFails: true });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("staged");
    expect(String(data["message"])).toMatch(/could not be started.*Prepare only/s);
    expect(made.status()).toBe("shortlisted");
    expect(made.browserOpens).toHaveLength(0);
    expect(existsSync(join(made.directory, "apply-helpers", "job-1.json"))).toBe(false);
  });

  it("starts no helper when the plain page already shows a question only the owner may answer", async () => {
    const made = world({ settings: FILL, form: "lever-style", profile: sampleProfile() });
    const data = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { "cards[relocate]": "Yes" },
      }),
    );
    expect(data["outcome"]).toBe("needs-you");
    expect(made.helperStarts).toHaveLength(0);
  });

  it("is not turned into a dry run by the dry-run-first setting", async () => {
    const made = world({
      settings: { ...FILL, dryRunFirst: true },
      ownerSubmits: true,
    });
    await made.call("apply_to_job", { jobId: "job-1" });
    await made.runHelper();
    expect(made.status()).toBe("applied");
  });
});

describe("apply_to_job at Automatic", () => {
  it("submits once without a typed yes and records applied with the evidence and every answer", async () => {
    const made = world({ settings: AUTO });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("applied");
    expect(data["status"]).toBe("applied");
    expect(made.driver.calls.filter((call) => call.startsWith("submit "))).toHaveLength(1);
    expect(made.driver.calls.at(-1)).toBe("close");
    for (const name of [
      "form-snapshot.json",
      "filled-values.json",
      "screenshot-before-submit.png",
      "screenshot-after-submit.png",
      "confirmation.txt",
      "evidence.json",
      "answers.json",
    ]) {
      expect(existsSync(join(made.evidenceDirectory, name)), name).toBe(true);
    }
    expect(JSON.parse(evidenceFile(made, "evidence.json")).outcome).toBe("applied");
  });

  it("writes the submit marker before the click", async () => {
    const statusesAtClick: (string | undefined)[] = [];
    const made = world({
      settings: AUTO,
      wrapDriver: (driver, application) => ({
        ...driver,
        submit: async (selector) => {
          statusesAtClick.push(application.jobStore.get("job-1")?.status);
          await driver.submit(selector);
        },
      }),
    });
    await made.call("apply_to_job", { jobId: "job-1" });
    expect(statusesAtClick).toEqual(["submitting"]);
  });

  it("records unverified when no confirmation message appears", async () => {
    const made = world({ settings: AUTO, confirmationText: "Your details were sent." });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("unverified");
    expect(made.status()).toBe("unverified");
  });

  it("does not count confirmation wording that was already on the page before the click", async () => {
    const banner = "Thank you for applying! Your application has been received.";
    const made = world({
      settings: AUTO,
      wrapDriver: (driver) => ({ ...driver, readConfirmation: async () => banner }),
    });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("unverified");
  });

  it("never submits the same job twice", async () => {
    const made = world({ settings: AUTO });
    await made.call("apply_to_job", { jobId: "job-1" });
    const before = made.driver.calls.filter((call) => call.startsWith("submit ")).length;
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(
      /applied.*never submitted twice/s,
    );
    expect(made.driver.calls.filter((call) => call.startsWith("submit ")).length).toBe(before);

    const interrupted = world({ settings: AUTO, jobStatus: "submitting" });
    expect(errorOf(await interrupted.call("apply_to_job", { jobId: "job-1" }))).toMatch(
      /never retries a submit/,
    );
    expect(interrupted.browserOpens).toHaveLength(0);
  });

  it("does a clean dry run first when dry run first is on, then submits on the second call", async () => {
    const made = world({ settings: { ...AUTO, dryRunFirst: true } });
    const first = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(first["outcome"]).toBe("dry-run-complete");
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    expect(made.status()).toBe("approved");
    const second = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(second["outcome"]).toBe("applied");
  });

  it("refuses when Scout is paused, before any browser opens", async () => {
    const made = world({ settings: { ...AUTO, automationPaused: true } });
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(/paused/i);
    expect(made.browserOpens).toHaveLength(0);
    expect(made.status()).toBe("shortlisted");
  });

  it("checks the kill switch again right before the click and then does not submit", async () => {
    const made = world({
      settings: AUTO,
      wrapDriver: (driver, application) => ({
        ...driver,
        fill: async (selector, value) => {
          await driver.fill(selector, value);
          application.settingsStore.save({
            ...application.settingsStore.load(),
            automationPaused: true,
          });
        },
      }),
    });
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(/paused/i);
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    expect(made.status()).not.toBe("submitting");
    expect(made.status()).not.toBe("applied");
  });

  it("refuses at the daily limit before any browser opens", async () => {
    const made = world({ settings: { ...AUTO, dailyApplicationLimit: 0 } });
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-1" }))).toMatch(/limit/i);
    expect(made.browserOpens).toHaveLength(0);
  });

  it("counts applications made today against the limit", async () => {
    const made = world({ settings: { ...AUTO, dailyApplicationLimit: 1 } });
    expect(dataOf(await made.call("apply_to_job", { jobId: "job-1" }))["outcome"]).toBe("applied");
    const second = { ...made.application.jobStore.get("job-1")!, id: "job-2" };
    made.application.jobStore.upsertPosting({
      id: second.id,
      company: "OtherCorp",
      title: "Backend Engineer",
      location: "Remote",
      remote: "remote",
      seniority: "mid",
      skills: [],
      description: "Fictional.",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      sources: [{ name: "greenhouse:othercorp", url: "https://example.com/jobs/2" }],
      canonicalUrl: "https://example.com/jobs/2",
      board: "greenhouse",
      flags: [],
    });
    made.application.jobStore.transition("job-2", "shortlisted", "test");
    expect(errorOf(await made.call("apply_to_job", { jobId: "job-2" }))).toMatch(/limit/i);
  });

  it("stops at a CAPTCHA, marks needs-you and fills nothing", async () => {
    const made = world({
      settings: AUTO,
      pageText: "Please verify you are human before you continue.",
    });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("needs-you");
    expect(made.status()).toBe("needs-you");
    expect(touching(made)).toEqual([]);
  });

  it("stops at a one-time code and marks a closed job closed", async () => {
    const code = world({ settings: AUTO, pageText: "Enter the 6-digit code we sent you." });
    expect(dataOf(await code.call("apply_to_job", { jobId: "job-1" }))["outcome"]).toBe(
      "needs-you",
    );
    const closed = world({
      settings: AUTO,
      pageText: "This job is no longer accepting applications.",
    });
    expect(dataOf(await closed.call("apply_to_job", { jobId: "job-1" }))["outcome"]).toBe("closed");
    expect(closed.status()).toBe("closed");
  });

  it("reports a form that is missing answers and changes nothing", async () => {
    const made = world({ settings: AUTO, html: sourceRequiredForm() });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("blocked");
    expect(touching(made)).toEqual([]);
    expect(made.status()).toBe("shortlisted");
  });

  it("hands a question only the owner may answer back to the owner and fills nothing", async () => {
    const made = world({ settings: AUTO, form: "lever-style", profile: sampleProfile() });
    const data = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { "cards[relocate]": "No" },
      }),
    );
    expect(data["outcome"]).toBe("needs-you");
    expect(touching(made)).toEqual([]);
    expect(made.status()).toBe("needs-you");
  });

  it("refuses a resume file outside Scout's folders", async () => {
    const made = world({ settings: AUTO });
    const outside = join(made.directory, "..", "other.pdf");
    writeFileSync(outside, "%PDF");
    expect(
      errorOf(await made.call("apply_to_job", { jobId: "job-1", resumePath: outside })),
    ).toMatch(/resumePath/);
  });
});

describe("apply_to_job at a sign-in wall", () => {
  const LINKEDIN = "https://www.linkedin.com/jobs/view/123/apply";

  /** A world whose browser is the fake LinkedIn site (a sign-in page, then the form). */
  function walledWorld(saved: boolean): {
    made: ActWorld;
    site: ReturnType<typeof createFakeSite>;
  } {
    const site = createFakeSite({ applicationHtml: formHtml("greenhouse-style") });
    const made = world({
      settings: {
        boardLevels: { greenhouse: "fill" },
        platformLogins: saved ? { linkedin: "saved" } : {},
      },
      posting: { canonicalUrl: LINKEDIN },
      wrapDriver: () => site,
      ...(saved
        ? {
            storedCredentials: {
              linkedin: { username: "alex@example.com", password: FAKE_PASSWORD },
            },
          }
        : {}),
    });
    if (saved) {
      writeFileSync(
        join(made.directory, "platform-sessions.json"),
        JSON.stringify({
          schemaVersion: 1,
          platforms: { linkedin: { username: "alex@example.com" } },
        }),
      );
    }
    return { made, site };
  }

  it("without saved credentials marks needs-you and names `scout login linkedin`", async () => {
    const { made, site } = walledWorld(false);
    expect(dataOf(await made.call("apply_to_job", { jobId: "job-1" }))["outcome"]).toBe(
      "waiting-for-you",
    );
    await made.runHelper({ wait: "0" });
    expect(made.status()).toBe("needs-you");
    expect(made.application.jobStore.get("job-1")?.statusReason).toMatch(/scout login linkedin/);
    expect(site.signInSubmits()).toBe(0);
    expect(made.vault.reads).toHaveLength(0);
  });

  it("with saved credentials signs in once, then fills, and never shows the password", async () => {
    const { made, site } = walledWorld(true);
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    await made.runHelper({ wait: "0" });
    expect(site.signInSubmits()).toBe(1);
    expect(made.status()).toBe("unverified");
    expect(JSON.stringify(data)).not.toContain(FAKE_PASSWORD);
    expect(readFileSync(join(made.evidenceDirectory, "answers.json"), "utf8")).not.toContain(
      FAKE_PASSWORD,
    );
  });
});

/** Adds a second shortlisted job and a resume PDF it may use; returns the resume path. */
function addSecondJob(made: ActWorld): string {
  made.application.jobStore.upsertPosting({
    id: "job-2",
    company: "OtherCorp",
    title: "Backend Engineer",
    location: "Remote",
    remote: "remote",
    seniority: "mid",
    skills: [],
    description: "Fictional.",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    sources: [{ name: "greenhouse:othercorp", url: "https://example.com/jobs/2" }],
    canonicalUrl: "https://example.com/jobs/2",
    board: "greenhouse",
    flags: [],
  });
  made.application.jobStore.transition("job-2", "shortlisted", "test");
  mkdirSync(join(made.directory, "resumes"), { recursive: true });
  const resume = join(made.directory, "resumes", "second.pdf");
  writeFileSync(resume, "%PDF-1.4 fictional second resume");
  return resume;
}

describe("the daily limit with parallel applications", () => {
  it("lets exactly one of two parallel calls through at limit minus one", async () => {
    const made = world({ settings: { ...AUTO, dailyApplicationLimit: 1 } });
    const resume = addSecondJob(made);
    const results = await Promise.all([
      made.call("apply_to_job", { jobId: "job-1" }),
      made.call("apply_to_job", { jobId: "job-2", resumePath: resume }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(errorOf(results.find((result) => !result.ok)!)).toMatch(/limit/i);
    expect(made.driver.calls.filter((call) => call.startsWith("submit "))).toHaveLength(1);
    const statuses = ["job-1", "job-2"].map((id) => made.application.jobStore.get(id)?.status);
    expect(statuses.filter((status) => status === "applied")).toHaveLength(1);
  });

  it("runs the calls of one process one after the other, never two browsers at once", async () => {
    let open = 0;
    let mostOpen = 0;
    const made = world({
      settings: { ...AUTO, dailyApplicationLimit: 5 },
      wrapDriver: (driver) => {
        // One browser session starts here and ends at its close (the run's own closes are no-ops).
        open += 1;
        mostOpen = Math.max(mostOpen, open);
        return {
          ...driver,
          open: async (url) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            await driver.open(url);
          },
          close: async () => {
            open -= 1;
            await driver.close();
          },
        };
      },
    });
    const resume = addSecondJob(made);
    await Promise.all([
      made.call("apply_to_job", { jobId: "job-1" }),
      made.call("apply_to_job", { jobId: "job-2", resumePath: resume }),
    ]);
    expect(mostOpen).toBe(1);
    // The shared fake page already showed its confirmation after the first submit, so the second
    // is correctly "unverified"; what matters here is that both ran, one after the other.
    expect(["applied", "unverified"]).toContain(made.application.jobStore.get("job-2")?.status);
  });

  it("claims the limit and the submit marker in one step, even from two processes", () => {
    const made = world({ settings: { ...AUTO, dailyApplicationLimit: 1 } });
    addSecondJob(made);
    for (const id of ["job-1", "job-2"]) {
      if (id === "job-2") made.application.jobStore.transition(id, "resume-ready", "test");
      made.application.jobStore.transition(id, "approved", "test");
    }
    const other = createApplication({
      directory: made.directory,
      now: () => new Date("2026-11-09T10:00:00.000Z"),
    });
    try {
      made.application.claimSubmitSlot("job-1", "first", 1);
      expect(() => other.claimSubmitSlot("job-2", "second", 1)).toThrow(/limit/i);
      expect(other.jobStore.get("job-2")?.status).toBe("approved");
      other.claimSubmitSlot("job-2", "second", 2);
      expect(other.jobStore.get("job-2")?.status).toBe("submitting");
    } finally {
      other.close();
    }
  });
});

describe("stopping while an application is running", () => {
  /** A client connected in memory to the real tools of a world. */
  async function connect(made: ActWorld, service: ReturnType<typeof createScoutMcpService>) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await service.server.connect(serverSide);
    await client.connect(clientSide);
    return client;
  }

  /** Waits (up to a second) until the test job reaches `status`. */
  async function untilStatus(made: ActWorld, status: string): Promise<void> {
    for (let tries = 0; tries < 200 && made.status() !== status; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(made.status()).toBe(status);
  }

  it("waits for a submit that is past its marker and records the outcome before it finishes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const made = world({
      settings: AUTO,
      wrapDriver: (driver) => ({
        ...driver,
        submit: async (selector) => {
          await gate;
          await driver.submit(selector);
        },
      }),
    });
    const service = createScoutMcpService(made.application, made.tools);
    const client = await connect(made, service);
    const call = client.callTool({ name: "apply_to_job", arguments: { jobId: "job-1" } });
    await untilStatus(made, "submitting");

    let stopped = false;
    const stopping = service.shutdown().then((drained) => {
      stopped = true;
      return drained;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    expect(made.status()).toBe("submitting");

    release();
    expect(await stopping).toBe(true);
    await call;
    expect(made.status()).toBe("applied");

    const late = (await client.callTool({
      name: "apply_to_job",
      arguments: { jobId: "job-2" },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(late.isError).toBe(true);
    expect(late.content[0]?.text).toMatch(/stopping/);
    await client.close();
  });

  it("starts no submit when the stop arrives before the marker", async () => {
    const holder: { service?: ReturnType<typeof createScoutMcpService> } = {};
    const made = world({
      settings: AUTO,
      wrapDriver: (driver) => ({
        ...driver,
        fill: async (selector, value) => {
          await driver.fill(selector, value);
          void holder.service?.shutdown();
        },
      }),
    });
    const service = createScoutMcpService(made.application, made.tools);
    holder.service = service;
    const client = await connect(made, service);
    const result = (await client.callTool({
      name: "apply_to_job",
      arguments: { jobId: "job-1" },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/stopping/);
    expect(made.driver.calls.some((call) => call.startsWith("submit "))).toBe(false);
    expect(made.status()).not.toBe("submitting");
    expect(made.status()).not.toBe("applied");
    await client.close();
  });

  it("gives up waiting after the bound and says so, without closing anything", async () => {
    const made = world({
      settings: AUTO,
      wrapDriver: (driver) => ({ ...driver, submit: () => new Promise<void>(() => {}) }),
    });
    const service = createScoutMcpService(made.application, made.tools, { drainMilliseconds: 50 });
    const client = await connect(made, service);
    void client.callTool({ name: "apply_to_job", arguments: { jobId: "job-1" } });
    await untilStatus(made, "submitting");
    expect(await service.shutdown()).toBe(false);
    expect(made.status()).toBe("submitting");
  });
});
