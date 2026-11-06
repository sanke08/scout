/**
 * Helpers shared by the apply tests: the saved fictional forms, the sample profile, settings,
 * a real job store on a temporary SQLite file and a fictional job. Only test files import this.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  profileSchema,
  type JobStatus,
  type JobStore,
  type Posting,
  type Profile,
  type Settings,
} from "../shared/index.js";
import { createJobStore, openDatabase } from "../store/index.js";
import { createFakeDriver, type FakeDriver, type FakeDriverOptions } from "./fake-driver.js";
import { mapFields } from "./map-fields.js";
import { planApplication, type FillPlan } from "./plan.js";
import { snapshotForm } from "./snapshot.js";

/** The three saved fictional form pages. */
export type FixtureName = "greenhouse-style" | "lever-style" | "ashby-style";

/** Reads one saved form page from `fixtures/forms/`. */
export function formHtml(name: FixtureName): string {
  return readFileSync(new URL(`../../fixtures/forms/${name}.html`, import.meta.url), "utf8");
}

/** The fictional sample profile (Alex Rivera, example.com). */
export function sampleProfile(): Profile {
  const text = readFileSync(new URL("../../fixtures/profile.sample.json", import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(text));
}

/** Default settings with overrides. */
export function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** An answer bank that covers every required question of the Greenhouse-style fixture. */
export function profileForGreenhouse(): Profile {
  const profile = sampleProfile();
  profile.answerBank.push({
    question: "Why do you want to work at ExampleCorp?",
    kind: "motivational",
    answer: "I like building reliable booking software.",
    approvedOn: "2026-02-01",
  });
  return profile;
}

/** A temporary folder and a function that removes it. */
export function makeTemporaryFolder(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "scout-apply-"));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/** A fictional posting. */
export function makePosting(): Posting {
  return {
    id: "job-1",
    company: "ExampleCorp",
    title: "Backend Engineer",
    location: "Remote",
    remote: "remote",
    seniority: "mid",
    skills: ["Node.js"],
    description: "Fictional posting text.",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    sources: [{ name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" }],
    canonicalUrl: "https://example.com/jobs/1",
    board: "greenhouse",
    flags: [],
  };
}

/** The statuses to walk through, in order, to reach each starting status. */
const PATH_TO_STATUS: Partial<Record<JobStatus, JobStatus[]>> = {
  "resume-ready": ["shortlisted", "resume-ready"],
  approved: ["shortlisted", "resume-ready", "approved"],
  shortlisted: ["shortlisted"],
};

/** A real job store on a temporary SQLite file with job `job-1` moved to `status`. */
export function makeJobStore(status: JobStatus = "approved"): {
  jobs: JobStore;
  remove: () => void;
} {
  const folder = makeTemporaryFolder();
  const jobs = createJobStore(openDatabase(join(folder.path, "scout.sqlite")));
  jobs.upsertPosting(makePosting());
  for (const step of PATH_TO_STATUS[status] ?? []) jobs.transition("job-1", step, "test setup");
  return { jobs, remove: folder.remove };
}

/** A fixed clock for the tests. */
export function fixedClock(): () => Date {
  return () => new Date("2026-03-01T10:00:00.000Z");
}

/** A fake driver on a saved form. */
export function driverFor(name: FixtureName, options: Partial<FakeDriverOptions> = {}): FakeDriver {
  return createFakeDriver({ html: formHtml(name), ...options });
}

/** Builds the plan for a saved form and profile the way a caller would. */
export function planFor(
  name: FixtureName,
  profile: Profile = profileForGreenhouse(),
  settings: Settings = settingsWith(),
  resumeFilePath: string | null = "/tmp/Alex_Rivera_ExampleCorp.pdf",
): FillPlan {
  const snapshot = snapshotForm(formHtml(name));
  const mappings = mapFields(snapshot, profile, profile.answerBank, settings);
  const input = { url: "https://example.com/jobs/1/apply", snapshot, mappings };
  return planApplication(resumeFilePath === null ? input : { ...input, resumeFilePath });
}
