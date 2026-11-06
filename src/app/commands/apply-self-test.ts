/**
 * `scout apply self-test <fixtureOrUrl>`: a dry run on a stable page that says whether a board's
 * adapter still works (Scenario P), and remembers the answer in `board-runs.json`.
 *
 * Why it exists: when a site renames a button or adds a field, the saved form shape changes. A
 * passed self-test counts as one clean run for the board; a failed one holds the board back to
 * "Fill, I submit" until a later self-test or dry run is clean. The self-test never submits: the
 * apply module's `runSelfTest` has no way to.
 *
 * It fills a test profile (never the user's own), so a public page only ever sees made-up details.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSelfTest } from "../../apply/index.js";
import {
  boardKindSchema,
  profileSchema,
  ScoutError,
  type BoardKind,
  type Profile,
} from "../../shared/index.js";
import type { Application } from "../application.js";
import { createBoardRunStore } from "../board-runs-store.js";
import type { ApplyEnvironment } from "./apply-environment.js";
import { findSampleProfile } from "./init.js";

/** The options of `scout apply self-test` as commander hands them over. */
export interface SelfTestCommandOptions {
  /** The board kind, when it cannot be told from the page address or file name. */
  board?: string;
  /** A test profile file to fill with. Default: the fictional sample profile that ships with Scout. */
  profileFile?: string;
  /** The shape hash saved from a good run; the self-test fails when the form's shape differs. */
  expectedShape?: string;
  /** Folder of Scout's own browser profile. Default: `<data>/browser-profile`. */
  profileDir?: string;
}

/** The board kinds a page address or file name can name. */
const NAMEABLE_BOARDS: readonly BoardKind[] = boardKindSchema.options.filter(
  (kind) => kind !== "feed" && kind !== "other",
);

/**
 * Finds the board kind: `--board` wins, otherwise the first kind named in the target.
 * Example: `fixtures/forms/lever-style.html` gives `lever`; `https://example.com/x` with no
 * `--board` throws and asks for it.
 */
export function boardKindOf(target: string, requested: string | undefined): BoardKind {
  if (requested !== undefined) {
    const parsed = boardKindSchema.safeParse(requested);
    if (!parsed.success) {
      throw new ScoutError(
        "invalid-input",
        `"${requested}" is not a board kind. Use one of: ${boardKindSchema.options.join(", ")}.`,
      );
    }
    return parsed.data;
  }
  const named = NAMEABLE_BOARDS.find((kind) => target.toLowerCase().includes(kind));
  if (named === undefined) {
    throw new ScoutError(
      "invalid-input",
      "Scout could not tell which board this page belongs to. Add --board greenhouse (or lever, ashby, ...).",
    );
  }
  return named;
}

/** Turns a saved page file into a `file://` address, or accepts an http or https address as it is. */
export function addressOf(target: string): string {
  const path = resolve(target);
  if (existsSync(path) && statSync(path).isFile()) return pathToFileURL(path).href;
  if (/^https?:\/\//i.test(target)) return target;
  throw new ScoutError(
    "invalid-input",
    `"${target}" is neither a saved page file that exists nor a web address starting with http:// or https://.`,
  );
}

/** Reads the test profile: the given file, or the fictional sample that ships with Scout. */
function loadTestProfile(file: string | undefined): Profile {
  const path = file === undefined ? findSampleProfile() : resolve(file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ScoutError("invalid-input", `The test profile ${path} could not be read as JSON.`);
  }
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ScoutError("invalid-input", `The test profile ${path} is not a valid profile.`);
  }
  return parsed.data;
}

/** The newest PDF in `<data>/resumes/`, or undefined: the file a form's resume field gets in a self-test. */
function newestResume(application: Application): string | undefined {
  const folder = join(application.directory, "resumes");
  if (!existsSync(folder)) return undefined;
  const pdfs = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => ({ path: join(folder, name), modified: statSync(join(folder, name)).mtimeMs }))
    .sort((first, second) => second.modified - first.modified);
  return pdfs[0]?.path;
}

/**
 * Runs the self-test and records the result. Prints the verdict and each reason.
 * Failure: a paused Scout, an unreadable target or profile throw a `ScoutError` before a page opens.
 */
export async function runSelfTestCommand(
  application: Application,
  environment: ApplyEnvironment,
  target: string,
  options: SelfTestCommandOptions,
): Promise<void> {
  application.assertNotPaused();
  const board = boardKindOf(target, options.board);
  const url = addressOf(target);
  const profile = loadTestProfile(options.profileFile);
  const resumeFilePath = newestResume(application);
  const driver = await environment.openBrowser({
    profileDirectory: resolve(options.profileDir ?? join(application.directory, "browser-profile")),
    headless: true,
  });
  const result = await runSelfTest(driver, {
    url,
    profile,
    settings: application.settingsStore.load(),
    ...(options.expectedShape === undefined ? {} : { expectedShapeHash: options.expectedShape }),
    ...(resumeFilePath === undefined ? {} : { resumeFilePath }),
  });

  const runs = createBoardRunStore(join(application.directory, "board-runs.json"));
  if (result.passed) {
    runs.recordCleanDryRun(board, application.now());
    console.log(`Self-test passed for ${board}. Nothing was submitted.`);
  } else {
    runs.recordFailedSelfTest(board, application.now());
    console.log(`Self-test FAILED for ${board}. Nothing was submitted.`);
    for (const reason of result.reasons) console.log(`  - ${reason}`);
    console.log(
      `Automatic submission is paused for ${board}: applications there stay at "Fill, I submit" until a self-test or dry run is clean.`,
    );
  }
  if (result.shapeHash !== undefined) console.log(`Form shape: ${result.shapeHash}`);
  application.actionLog.append({
    actor: "app",
    action: "self-test",
    detail: `${board}: ${result.passed ? "passed" : `failed (${result.reasons.length} reason(s))`}`,
  });
}
