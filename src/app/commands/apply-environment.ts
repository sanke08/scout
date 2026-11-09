/**
 * The few outside effects the apply commands need (a browser, a plain page download, a line typed
 * by the user, a LaTeX compile and a pause), gathered in one place so tests can replace them.
 *
 * Why it exists: `scout apply` must never need a real browser, network, keyboard or LaTeX in a test.
 * Every one of these is therefore an argument with a real default. The real program passes none;
 * a test passes `apply: { openBrowser, readLine, ... }` in the overrides of `main(argv, overrides)`.
 *
 * Example: `resolveApplyEnvironment({ readLine: async () => "yes" }).readLine("Sure? ")` gives `"yes"`
 * without touching the keyboard; every method left out uses the real thing.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createPlaywrightDriver, type BrowserDriver } from "../../apply/index.js";
import { compileResume, type CompiledResume } from "../../resume/index.js";
import { ScoutError } from "../../shared/index.js";

/** What opening a browser needs: where its profile lives and whether it is hidden. */
export interface BrowserOpenOptions {
  /** The folder of Scout's own browser profile (cookies and sessions). Never the user's everyday profile. */
  profileDirectory: string;
  /** True for a hidden browser (self-tests); false shows the window so the user can watch and take over. */
  headless: boolean;
}

/** What starting the detached helper window needs. */
export interface HelperRequest {
  /** The arguments after the Scout program file, for example `["apply-keep-open", jobId, ...]`. */
  args: string[];
  /** The absolute data folder, so the helper opens the same one whatever its working folder. */
  dataDirectory: string;
}

/** Every outside effect of the apply commands. */
export interface ApplyEnvironment {
  /** Starts a browser and returns its driver. Default: the Playwright driver (untested against a real browser). */
  openBrowser(options: BrowserOpenOptions): Promise<BrowserDriver>;
  /** Downloads the plain HTML of a page without a browser. Default: the global `fetch`, web addresses only. */
  readFormPage(url: string): Promise<string>;
  /** Shows `prompt` and returns the line the user types (an empty string when input has ended). Default: standard input. */
  readLine(prompt: string): Promise<string>;
  /** Compiles LaTeX source to a PDF. Default: the resume module's `pdflatex` compile. */
  compileResume(
    texSource: string,
    outputDirectory: string,
    fileStem: string,
  ): Promise<CompiledResume>;
  /**
   * Starts Scout again as a detached background process (its own session, no input or output,
   * it keeps running after this process ends). Resolves once the process has started; rejects with
   * the reason when it could not be started. Default: spawns the current program file.
   */
  startHelper(request: HelperRequest): Promise<void>;
  /** Waits. Default: a real timer. Used between looks for the confirmation page. */
  pause(milliseconds: number): Promise<void>;
}

/** The parts a caller may replace; anything left out keeps its real default. */
export type ApplyEnvironmentOverrides = Partial<ApplyEnvironment>;

/** The largest page `readFormPage` accepts, in bytes. A form page is far smaller; more is refused. */
const MAXIMUM_PAGE_BYTES = 5 * 1024 * 1024;

/** The real `readFormPage`: one plain download of an http or https page, with a size limit. */
async function downloadPage(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new ScoutError("invalid-input", `Scout can only download web addresses, not "${url}".`);
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ScoutError("unavailable", `Scout could not download ${url}. Check the connection.`);
  }
  if (!response.ok) {
    throw new ScoutError(
      "unavailable",
      `The page ${url} answered with status ${response.status}, so Scout could not read the form.`,
    );
  }
  const text = await response.text();
  if (text.length > MAXIMUM_PAGE_BYTES) {
    throw new ScoutError("unavailable", `The page ${url} is too large to read as a form.`);
  }
  return text;
}

/** The real `readLine`: prints the prompt and resolves with the next typed line, or "" when input ends. */
function readLineFromKeyboard(prompt: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    reader.once("close", () => resolve(""));
    reader.question(prompt, (answer) => {
      resolve(answer);
      reader.close();
    });
  });
}

/** The real `startHelper`: the same Node program and Scout file, detached from this process. */
function startDetachedHelper(request: HelperRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const entryFile = process.argv[1];
    if (entryFile === undefined) {
      reject(new Error("the Scout program file is not known"));
      return;
    }
    try {
      const child = spawn(process.execPath, [...process.execArgv, entryFile, ...request.args], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, SCOUT_DATA_DIR: request.dataDirectory },
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Fills in the real default for everything `overrides` leaves out. */
export function resolveApplyEnvironment(
  overrides: ApplyEnvironmentOverrides | undefined,
): ApplyEnvironment {
  return {
    openBrowser: overrides?.openBrowser ?? ((options) => createPlaywrightDriver(options)),
    readFormPage: overrides?.readFormPage ?? downloadPage,
    readLine: overrides?.readLine ?? readLineFromKeyboard,
    compileResume:
      overrides?.compileResume ??
      ((texSource, outputDirectory, fileStem) =>
        compileResume(texSource, outputDirectory, undefined, fileStem)),
    startHelper: overrides?.startHelper ?? startDetachedHelper,
    pause:
      overrides?.pause ??
      ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}
