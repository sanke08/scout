/**
 * Helpers for the apply end-to-end tests: a temporary data folder holding a fictional profile, one
 * fictional job in a chosen status, a tailored resume in its job folder, and the fakes that replace
 * the browser, the typed line, the page download and LaTeX.
 *
 * Only test files import this. Everything is fictional (Alex Rivera, example.com); no test using
 * it opens a browser, uses the network, asks a person or needs `pdflatex`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplicationOptions, Application } from "../src/app/index.js";
import { createApplication } from "../src/app/index.js";
import type { BrowserDriver } from "../src/apply/index.js";
import { createFakeDriver, type FakeDriver } from "../src/apply/fake-driver.js";
import {
  formHtml,
  makePosting,
  profileForGreenhouse,
  sampleProfile,
  type FixtureName,
} from "../src/apply/test-helpers.js";
import { createJobFolderManager } from "../src/folders/index.js";
import {
  DEFAULT_SETTINGS,
  ScoutError,
  type JobStatus,
  type Profile,
  type Settings,
} from "../src/shared/index.js";
import { FIXED_NOW, runCli, type CliResult } from "./helpers.js";

/** The walk from a new `found` job to each status the tests start in. */
const PATH_TO_STATUS: Partial<Record<JobStatus, JobStatus[]>> = {
  shortlisted: ["shortlisted"],
  "resume-ready": ["shortlisted", "resume-ready"],
  approved: ["shortlisted", "resume-ready", "approved"],
  submitting: ["shortlisted", "resume-ready", "approved", "submitting"],
  "needs-you": ["shortlisted", "resume-ready", "approved", "needs-you"],
  applied: ["shortlisted", "resume-ready", "approved", "submitting", "applied"],
};

/** What to set up. Everything has a safe default: a `resume-ready` job, the Greenhouse-style form, the Fill level. */
export interface ApplyWorldOptions {
  /** The job's status at the start. Default `resume-ready`. */
  jobStatus?: JobStatus;
  /** Which saved fictional form the page shows. Default `greenhouse-style`. */
  form?: FixtureName;
  /** Settings overrides on top of the defaults. */
  settings?: Partial<Settings>;
  /** The profile on disk. Default: the sample plus the answer the Greenhouse form needs. */
  profile?: Profile;
  /** The text the page shows after a submit, or what a user's own submit shows. Default: a normal confirmation. */
  confirmationText?: string;
  /** Makes the fake browser crash during the final click. */
  submitThrows?: boolean;
  /** Puts a tailored resume PDF in the job's folder. Default true. */
  seedResume?: boolean;
  /** The lines the user "types", in order. Default none (an empty line). */
  typedLines?: string[];
  /** Replaces the driver the commands get, for example to simulate the user pressing submit. */
  wrapDriver?: (driver: FakeDriver) => BrowserDriver;
  /** Makes the stand-in LaTeX compile throw this message (as a missing `pdflatex` does). */
  compileFailure?: string;
}

/** A prepared data folder plus everything the tests look at afterwards. */
export interface ApplyWorld {
  directory: string;
  /** The fake browser the commands drive. */
  driver: FakeDriver;
  /** How many times a browser was opened, and with which options. */
  browserOpens: { profileDirectory: string; headless: boolean }[];
  /** The prompts the user was asked, in order. */
  prompts: string[];
  /** The addresses downloaded without a browser. */
  pageDownloads: string[];
  /** How many times LaTeX was asked to compile. */
  compileCount: () => number;
  /** The overrides for `main`, with the fakes in place. */
  overrides(extra?: ApplicationOptions): ApplicationOptions;
  /** Runs the real entry point and captures its output. */
  run(args: string[], extra?: ApplicationOptions): Promise<CliResult>;
  /** Opens the application on the same folder for a moment, to read or change stored facts. */
  inspect<T>(body: (application: Application) => T): T;
  /** The folder where this job's evidence goes. */
  evidenceDirectory: string;
  remove: () => void;
}

/** Sets up a world as described in the file comment. */
export function makeApplyWorld(options: ApplyWorldOptions = {}): ApplyWorld {
  const directory = mkdtempSync(join(tmpdir(), "scout-apply-e2e-"));
  const profile = options.profile ?? profileForGreenhouse();
  writeFileSync(join(directory, "profile.json"), JSON.stringify(profile, null, 2));

  const posting = makePosting();
  const baseOverrides: ApplicationOptions = { directory, now: () => FIXED_NOW };
  const setup = createApplication(baseOverrides);
  setup.settingsStore.save({ ...DEFAULT_SETTINGS, ...options.settings });
  setup.jobStore.upsertPosting(posting);
  for (const step of PATH_TO_STATUS[options.jobStatus ?? "resume-ready"] ?? []) {
    setup.jobStore.transition(posting.id, step, "test setup");
  }
  const folders = createJobFolderManager({
    jobsDirectory: join(directory, "jobs"),
    now: () => FIXED_NOW,
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
  setup.close();

  const driver = createFakeDriver({
    html: formHtml(options.form ?? "greenhouse-style"),
    ...(options.confirmationText === undefined
      ? {}
      : { confirmationText: options.confirmationText }),
    ...(options.submitThrows === true ? { submitThrows: true } : {}),
  });
  const browserOpens: ApplyWorld["browserOpens"] = [];
  const prompts: string[] = [];
  const pageDownloads: string[] = [];
  const typed = [...(options.typedLines ?? [])];
  let compiles = 0;

  const overrides = (extra: ApplicationOptions = {}): ApplicationOptions => ({
    ...baseOverrides,
    apply: {
      openBrowser: async (browserOptions) => {
        browserOpens.push(browserOptions);
        return options.wrapDriver === undefined ? driver : options.wrapDriver(driver);
      },
      readFormPage: async (url) => {
        pageDownloads.push(url);
        return formHtml(options.form ?? "greenhouse-style");
      },
      readLine: async (prompt) => {
        prompts.push(prompt);
        return typed.shift() ?? "";
      },
      compileResume: async (_source, outputDirectory, fileStem) => {
        compiles += 1;
        if (options.compileFailure !== undefined) {
          throw new ScoutError("unavailable", options.compileFailure);
        }
        mkdirSync(outputDirectory, { recursive: true });
        const pdfPath = join(outputDirectory, `${fileStem}.pdf`);
        writeFileSync(pdfPath, "%PDF-1.4 fictional built resume");
        return { pdfPath, pageCount: 1 };
      },
      pause: async () => {},
    },
    ...extra,
  });

  return {
    directory,
    driver,
    browserOpens,
    prompts,
    pageDownloads,
    compileCount: () => compiles,
    overrides,
    run: (args, extra) => runCli(args, overrides(extra)),
    inspect(body) {
      const application = createApplication(baseOverrides);
      try {
        return body(application);
      } finally {
        application.close();
      }
    },
    evidenceDirectory: join(directory, "jobs", folder.name, "evidence"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

/** The sample profile as the tests use it when a form must be left with unanswered questions. */
export function profileWithoutAnswers(): Profile {
  return sampleProfile();
}
