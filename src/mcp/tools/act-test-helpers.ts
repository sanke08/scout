/**
 * Helpers shared by the acting-tool tests: a temporary data folder with a fictional profile and one
 * fictional job, the apply module's fake browser on saved forms, a fake page download, a stand-in
 * LaTeX compile, a fake mailbox, and a way to call a tool the way the MCP server does.
 *
 * Only test files import this. Everything is fictional (Alex Rivera, example.com); a test using it
 * never opens a browser, uses the network, reads a real mailbox or needs `pdflatex`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication, type Application } from "../../app/index.js";
import type { BrowserDriver } from "../../apply/index.js";
import { createFakeDriver, type FakeDriver } from "../../apply/fake-driver.js";
import {
  formHtml,
  makePosting,
  profileForGreenhouse,
  type FixtureName,
} from "../../apply/test-helpers.js";
import { createJobFolderManager } from "../../folders/index.js";
import { createFakeVault, type FakeVault } from "../../platforms/fake-vault.js";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  type JobStatus,
  type Posting,
  type Profile,
  type Settings,
} from "../../shared/index.js";
import type { MailConnection } from "../../tracking/index.js";
import type { ScoutTool, ToolResult } from "../tool.js";
import { createActTools } from "./act-tools.js";

/** The moment every acting-tool test treats as "now". */
export const NOW = new Date("2026-11-09T10:00:00.000Z");

/** The walk from a new `found` job to each status the tests start in. */
const PATH_TO_STATUS: Partial<Record<JobStatus, JobStatus[]>> = {
  shortlisted: ["shortlisted"],
  "resume-ready": ["shortlisted", "resume-ready"],
  approved: ["shortlisted", "resume-ready", "approved"],
  submitting: ["shortlisted", "resume-ready", "approved", "submitting"],
  applied: ["shortlisted", "resume-ready", "approved", "submitting", "applied"],
};

/** What to set up. Everything has a safe default: a shortlisted job, the Greenhouse-style form, Prepare only. */
export interface ActWorldOptions {
  jobStatus?: JobStatus;
  form?: FixtureName;
  settings?: Partial<Settings>;
  profile?: Profile;
  posting?: Partial<Posting>;
  /** The text the page shows after a submit. */
  confirmationText?: string;
  /** Puts a tailored resume PDF in the job folder. Default true. */
  seedResume?: boolean;
  /** Replaces the driver the browser opens (for example to flip the pause switch mid-fill). */
  wrapDriver?: (driver: FakeDriver, application: Application) => BrowserDriver;
  /** Makes the stand-in LaTeX compile throw this error (as a missing `pdflatex` does). */
  compileFailure?: ScoutError;
  /** The page text the fake browser reports (to simulate a CAPTCHA wall). */
  pageText?: string;
  /** Environment variables the application sees (the mail settings). */
  environment?: Record<string, string | undefined>;
  /** Saved emails (names under `fixtures/mail`) the fake mailbox serves. */
  mailConnection?: MailConnection;
  /** Credentials already in the fake keychain, by platform. */
  storedCredentials?: Record<string, { username: string; password: string }>;
  /** Makes the plain page download fail. */
  downloadFails?: boolean;
}

/** A prepared world plus everything the tests look at afterwards. */
export interface ActWorld {
  application: Application;
  directory: string;
  driver: FakeDriver;
  vault: FakeVault;
  /** Browsers opened, in order. */
  browserOpens: string[];
  /** Addresses downloaded without a browser. */
  pageDownloads: string[];
  /** The tool log lines (`context.note`). */
  notes: string[];
  /** The folder where the job's evidence goes. */
  evidenceDirectory: string;
  /** Validates the input like the server does, then runs the tool. */
  call(name: string, input: unknown): Promise<ToolResult>;
  /** Turns the kill switch on. */
  pause(): void;
  /** The status of the test job. */
  status(): string | undefined;
  remove: () => void;
}

/** Sets up a world as described in the file comment. */
export function makeActWorld(options: ActWorldOptions = {}): ActWorld {
  const directory = mkdtempSync(join(tmpdir(), "scout-act-"));
  const profile = options.profile ?? profileForGreenhouse();
  writeFileSync(join(directory, "profile.json"), JSON.stringify(profile, null, 2));

  const driver = createFakeDriver({
    html: formHtml(options.form ?? "greenhouse-style"),
    ...(options.confirmationText === undefined
      ? {}
      : { confirmationText: options.confirmationText }),
    ...(options.pageText === undefined ? {} : { pageText: options.pageText }),
  });
  const vault = createFakeVault({ supported: true, stored: options.storedCredentials ?? {} });
  const browserOpens: string[] = [];
  const pageDownloads: string[] = [];
  const notes: string[] = [];
  /** Filled in once the application exists; the fake browser needs it to flip the pause switch. */
  const holder: { application?: Application } = {};

  const apply = {
    openBrowser: async (browserOptions: { profileDirectory: string }) => {
      browserOpens.push(browserOptions.profileDirectory);
      return options.wrapDriver === undefined
        ? driver
        : options.wrapDriver(driver, holder.application as Application);
    },
    readFormPage: async (url: string) => {
      pageDownloads.push(url);
      if (options.downloadFails === true) throw new Error("offline");
      return formHtml(options.form ?? "greenhouse-style");
    },
    compileResume: async (_source: string, outputDirectory: string, fileStem: string) => {
      if (options.compileFailure !== undefined) throw options.compileFailure;
      mkdirSync(outputDirectory, { recursive: true });
      const pdfPath = join(outputDirectory, `${fileStem}.pdf`);
      writeFileSync(pdfPath, "%PDF-1.4 fictional built resume");
      return { pdfPath, pageCount: 1 };
    },
    pause: async () => {},
  };

  const application = createApplication({
    directory,
    now: () => NOW,
    apply,
    platforms: { vault },
    environment: options.environment ?? {},
    ...(options.mailConnection === undefined
      ? {}
      : { mailboxConnector: () => async () => options.mailConnection as MailConnection }),
  });
  holder.application = application;
  application.settingsStore.save({ ...DEFAULT_SETTINGS, ...options.settings });
  const posting = { ...makePosting(), ...options.posting };
  application.jobStore.upsertPosting(posting);
  for (const step of PATH_TO_STATUS[options.jobStatus ?? "shortlisted"] ?? []) {
    application.jobStore.transition(posting.id, step, "test setup");
  }
  const folders = createJobFolderManager({
    jobsDirectory: join(directory, "jobs"),
    now: () => NOW,
  });
  const folder = folders.ensureJobFolder(posting);
  if (options.seedResume !== false) {
    const pdfPath = join(directory, "Alex_Rivera_ExampleCorp.pdf");
    writeFileSync(pdfPath, "%PDF-1.4 fictional test resume");
    folders.saveTailoredResume(folder.name, {
      fileStem: "Alex_Rivera_ExampleCorp",
      texSource: "fictional source",
      pdfPath,
    });
  }

  const tools = new Map<string, ScoutTool>(
    createActTools({ apply, platforms: { vault } }).map((tool) => [tool.name, tool]),
  );
  const world: ActWorld = {
    application,
    directory,
    driver,
    vault,
    browserOpens,
    pageDownloads,
    notes,
    evidenceDirectory: join(directory, "jobs", folder.name, "evidence"),
    async call(name, input) {
      const tool = tools.get(name);
      if (tool === undefined) throw new Error(`No tool named ${name}.`);
      const parsed = tool.inputSchema.parse(input);
      return tool.handler(parsed, {
        application: world.application,
        assertNotPaused: () => world.application.assertNotPaused(),
        note: (line) => notes.push(line),
      });
    },
    pause() {
      world.application.settingsStore.save({
        ...world.application.settingsStore.load(),
        automationPaused: true,
      });
    },
    status: () => world.application.jobStore.get(posting.id)?.status,
    remove() {
      world.application.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
  return world;
}

/** The data of a successful result; fails the test when the result is an error. */
export function dataOf(result: ToolResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`Expected success but got an error: ${result.error}`);
  return result.data as Record<string, unknown>;
}

/** The error sentence of a failed result; fails the test when the result succeeded. */
export function errorOf(result: ToolResult): string {
  if (result.ok) throw new Error("Expected an error but the tool succeeded.");
  return result.error;
}
