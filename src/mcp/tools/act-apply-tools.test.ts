/**
 * Tests of `get_form` and `apply_to_job` through the tool handlers, with the apply module's fake
 * browser on saved fictional forms and a fake vault. No real browser, network or keychain.
 *
 * What must stay true: Prepare opens no browser; Fill never submits and leaves the window open;
 * Automatic submits at most once, only with the kill switch off and the daily limit not reached,
 * and records applied only for new confirmation text; a sign-in wall, CAPTCHA or missing answer
 * never gets past; every answer is saved in the evidence; a job is never submitted twice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formHtml, sampleProfile } from "../../apply/test-helpers.js";
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
    expect(message).toMatch(/same site/);
    expect(made.pageDownloads).toHaveLength(0);
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
    const made = world({ form: "lever-style", profile: sampleProfile() });
    const blocked = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(blocked["outcome"]).toBe("blocked");
    const missing = (blocked["missingFields"] as { fieldKey: string }[]).map((f) => f.fieldKey);
    expect(missing).toContain("cards[relocate]");
    expect(made.status()).toBe("shortlisted");

    const staged = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { "cards[relocate]": "Yes" },
      }),
    );
    expect(staged["outcome"]).toBe("staged");
    expect(JSON.parse(evidenceFile(made, "answers.json")).values["cards[relocate]"].source).toBe(
      "model-answer",
    );
  });

  it("refuses an answer that is not one of the listed choices, and keeps the profile's own values", async () => {
    const made = world({ form: "lever-style", profile: sampleProfile() });
    const data = dataOf(
      await made.call("apply_to_job", {
        jobId: "job-1",
        answers: { "cards[relocate]": "Maybe", email: "someone-else@example.net" },
      }),
    );
    expect(data["outcome"]).toBe("blocked");
    const refused = data["refusedAnswers"] as { fieldKey: string }[];
    expect(refused.map((item) => item.fieldKey)).toContain("cards[relocate]");
    const ignored = data["ignoredAnswers"] as { fieldKey: string }[];
    expect(ignored.map((item) => item.fieldKey)).toContain("email");
  });

  it("stages the resume even when the form cannot be read without a browser", async () => {
    const made = world({ downloadFails: true });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("staged");
    expect(made.browserOpens).toHaveLength(0);
  });
});

describe("apply_to_job at Fill, I submit", () => {
  it("fills, never submits, leaves the window open and marks the job needs-you with the reason", async () => {
    const made = world({ settings: { boardLevels: { greenhouse: "fill" } } });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("filled-for-review");
    expect(data["status"]).toBe("needs-you");
    expect(made.status()).toBe("needs-you");
    expect(made.browserOpens).toHaveLength(1);
    expect(touching(made).some((call) => call.startsWith("fill "))).toBe(true);
    expect(touching(made).some((call) => call.startsWith("submit "))).toBe(false);
    expect(made.driver.calls).not.toContain("close");
    expect(made.application.jobStore.get("job-1")?.statusReason).toBe(
      "form filled, waiting for you to press submit",
    );
  });

  it("is not turned into a dry run by the dry-run-first setting", async () => {
    const made = world({ settings: { boardLevels: { greenhouse: "fill" }, dryRunFirst: true } });
    expect(dataOf(await made.call("apply_to_job", { jobId: "job-1" }))["outcome"]).toBe(
      "filled-for-review",
    );
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
    const made = world({ settings: AUTO, form: "lever-style", profile: sampleProfile() });
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("blocked");
    expect(touching(made)).toEqual([]);
    expect(made.status()).toBe("shortlisted");
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
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(data["outcome"]).toBe("needs-you");
    expect(data["message"]).toMatch(/scout login linkedin/);
    expect(site.signInSubmits()).toBe(0);
    expect(made.vault.reads).toHaveLength(0);
  });

  it("with saved credentials signs in once, then fills, and never shows the password", async () => {
    const { made, site } = walledWorld(true);
    const data = dataOf(await made.call("apply_to_job", { jobId: "job-1" }));
    expect(site.signInSubmits()).toBe(1);
    expect(data["outcome"]).toBe("filled-for-review");
    expect(JSON.stringify(data)).not.toContain(FAKE_PASSWORD);
    expect(readFileSync(join(made.evidenceDirectory, "answers.json"), "utf8")).not.toContain(
      FAKE_PASSWORD,
    );
  });
});
