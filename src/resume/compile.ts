/**
 * Compiling the LaTeX source into a PDF with `pdflatex`, and counting its pages.
 *
 * This is an optional local step (D-004): building the source needs no LaTeX, only getting a PDF
 * does. The program runner is injectable, so unit tests use a fake and never need LaTeX installed.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ScoutError } from "../shared/index.js";

/** What a finished program left behind. */
export interface ProcessResult {
  /** The program's exit code; 0 means success. */
  exitCode: number;
  /** Everything it printed (standard output and standard error together). */
  output: string;
}

/**
 * Runs one program to the end in `workingDirectory`. It must reject with an error whose `code` is
 * `"ENOENT"` when the program is not installed, as Node's own process start does.
 *
 * Example: `runner("pdflatex", ["-version"], "/tmp/out")` resolves `{ exitCode: 0, output: "pdfTeX ..." }`.
 */
export type ProcessRunner = (
  command: string,
  args: string[],
  workingDirectory: string,
) => Promise<ProcessResult>;

/** The result of a successful compile. */
export interface CompiledResume {
  /** Absolute or relative path of the PDF, inside the output directory. */
  pdfPath: string;
  /** Number of pages in the PDF; a good resume has exactly 1. */
  pageCount: number;
}

/** Lines of the LaTeX log shown in an error message, enough to see the first complaint. */
const LOG_TAIL_LINES = 20;

/** The options given to every `pdflatex` run: never stop to ask a question, stop at the first error. */
const PDFLATEX_ARGUMENTS = ["-interaction=nonstopmode", "-halt-on-error"];

/** Tells the user how to get a LaTeX program when it is missing. */
const INSTALL_HINT =
  "Install a LaTeX distribution (MacTeX or TeX Live), or add its bin folder to PATH " +
  "(on a Mac that is /Library/TeX/texbin), then run this again. The resume source was not compiled.";

/**
 * The real runner: starts the program with Node's `child_process` and collects its output.
 * A program that is not installed makes the returned promise reject with code `"ENOENT"`.
 */
export function runProcess(
  command: string,
  args: string[],
  workingDirectory: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, output }));
  });
}

/** True when the error means "that program is not installed". */
function isMissingProgram(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Reads a text file, or returns undefined when it does not exist. */
async function readTextIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

/** The last lines of a text, for error messages. */
function lastLines(text: string, count: number): string {
  return text.trimEnd().split("\n").slice(-count).join("\n");
}

/** Runs `pdflatex` once; turns "not installed" and "failed" into a `ScoutError` with advice. */
async function runPdflatex(
  runner: ProcessRunner,
  outputDirectory: string,
  texFileName: string,
  logPath: string,
): Promise<ProcessResult> {
  let result: ProcessResult;
  try {
    result = await runner("pdflatex", [...PDFLATEX_ARGUMENTS, texFileName], outputDirectory);
  } catch (error) {
    if (isMissingProgram(error)) {
      throw new ScoutError("unavailable", `The pdflatex program was not found. ${INSTALL_HINT}`);
    }
    throw error;
  }
  if (result.exitCode !== 0) {
    const log = (await readTextIfPresent(logPath)) ?? result.output;
    throw new ScoutError(
      "invalid-input",
      `pdflatex could not compile the resume (exit code ${result.exitCode}). End of the log:\n${lastLines(log, LOG_TAIL_LINES)}`,
    );
  }
  return result;
}

/** Asks `pdfinfo` for the page count; undefined when it is not installed or gives no answer. */
async function countPagesWithPdfinfo(
  runner: ProcessRunner,
  outputDirectory: string,
  pdfFileName: string,
): Promise<number | undefined> {
  try {
    const result = await runner("pdfinfo", [pdfFileName], outputDirectory);
    const match = /^Pages:\s+(\d+)/m.exec(result.output);
    return result.exitCode === 0 && match?.[1] !== undefined ? Number(match[1]) : undefined;
  } catch (error) {
    if (isMissingProgram(error)) return undefined;
    throw error;
  }
}

/** Reads the page count from the line "Output written on x.pdf (1 page, ...)" of a LaTeX log. */
function countPagesInLog(log: string): number | undefined {
  const match = /Output written on .*?\((\d+) pages?/s.exec(log);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Compiles LaTeX source into a PDF and reports its page count.
 *
 * Writes `<fileStem>.tex` into `outputDirectory` (created when missing), runs `pdflatex` twice
 * with `-interaction=nonstopmode -halt-on-error` (twice so links settle), then counts pages with
 * `pdfinfo` when it is installed, otherwise from the LaTeX log.
 *
 * Example: `compileResume(source, "/tmp/out")` resolves `{ pdfPath: "/tmp/out/resume.pdf", pageCount: 1 }`.
 * Failure: a missing `pdflatex` throws `ScoutError("unavailable")` with an install hint; a source
 * that does not compile throws `ScoutError("invalid-input")` with the end of the log.
 */
export async function compileResume(
  texSource: string,
  outputDirectory: string,
  runner: ProcessRunner = runProcess,
  fileStem = "resume",
): Promise<CompiledResume> {
  await mkdir(outputDirectory, { recursive: true });
  const texFileName = `${fileStem}.tex`;
  const pdfFileName = `${fileStem}.pdf`;
  const logPath = path.join(outputDirectory, `${fileStem}.log`);
  await writeFile(path.join(outputDirectory, texFileName), texSource, "utf8");

  await runPdflatex(runner, outputDirectory, texFileName, logPath);
  const secondRun = await runPdflatex(runner, outputDirectory, texFileName, logPath);

  const pdfPath = path.join(outputDirectory, pdfFileName);
  const fromPdfinfo = await countPagesWithPdfinfo(runner, outputDirectory, pdfFileName);
  const log = (await readTextIfPresent(logPath)) ?? secondRun.output;
  const pageCount = fromPdfinfo ?? countPagesInLog(log);
  if (pageCount === undefined) {
    throw new ScoutError(
      "unavailable",
      "pdflatex finished but the page count could not be read, because pdfinfo is not installed and the log has no page line. Open the PDF to check its length.",
    );
  }
  return { pdfPath, pageCount };
}
