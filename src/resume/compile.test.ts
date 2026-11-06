import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { compileResume } from "./compile.js";
import type { ProcessResult, ProcessRunner } from "./compile.js";

/** A fake program runner: records every call and answers per command name. */
function fakeRunner(
  answers: Record<string, (args: string[], directory: string) => Promise<ProcessResult>>,
  calls: string[] = [],
): ProcessRunner {
  return async (command, args, directory) => {
    calls.push(`${command} ${args.join(" ")}`);
    const answer = answers[command];
    if (answer === undefined) {
      throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
    }
    return answer(args, directory);
  };
}

/** Writes a pretend LaTeX log and reports success. */
async function succeedWithLog(directory: string, pages: number): Promise<ProcessResult> {
  const log = `This is pdfTeX\nOutput written on resume.pdf (${pages} page, 41234 bytes).\n`;
  await writeFile(path.join(directory, "resume.log"), log);
  return { exitCode: 0, output: log };
}

async function makeDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "scout-resume-test-"));
}

describe("compileResume", () => {
  it("writes the source, runs pdflatex twice and reads the page count from pdfinfo", async () => {
    const directory = await makeDirectory();
    const calls: string[] = [];
    const runner = fakeRunner(
      {
        pdflatex: (_args, cwd) => succeedWithLog(cwd, 1),
        pdfinfo: async () => ({ exitCode: 0, output: "Title: x\nPages:           1\n" }),
      },
      calls,
    );
    const result = await compileResume("\\documentclass{article}", directory, runner);
    expect(result).toEqual({ pdfPath: path.join(directory, "resume.pdf"), pageCount: 1 });
    expect(await readFile(path.join(directory, "resume.tex"), "utf8")).toBe(
      "\\documentclass{article}",
    );
    const latexCalls = calls.filter((call) => call.startsWith("pdflatex"));
    expect(latexCalls).toHaveLength(2);
    expect(latexCalls[0]).toContain("-interaction=nonstopmode");
    expect(latexCalls[0]).toContain("-halt-on-error");
  });

  it("falls back to the log for the page count when pdfinfo is missing", async () => {
    const directory = await makeDirectory();
    const runner = fakeRunner({ pdflatex: (_args, cwd) => succeedWithLog(cwd, 2) });
    const result = await compileResume("x", directory, runner);
    expect(result.pageCount).toBe(2);
  });

  it("puts the end of the log in the error when pdflatex fails", async () => {
    const directory = await makeDirectory();
    const runner = fakeRunner({
      pdflatex: async (_args, cwd) => {
        await writeFile(path.join(cwd, "resume.log"), "line one\n! Undefined control sequence.\n");
        return { exitCode: 1, output: "" };
      },
    });
    const failure = await compileResume("x", directory, runner).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ScoutError);
    expect((failure as ScoutError).code).toBe("invalid-input");
    expect((failure as ScoutError).message).toContain("! Undefined control sequence.");
  });

  it("reports an unavailable tool with an install hint when pdflatex is missing", async () => {
    const directory = await makeDirectory();
    const failure = await compileResume("x", directory, fakeRunner({})).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ScoutError);
    expect((failure as ScoutError).code).toBe("unavailable");
    expect((failure as ScoutError).message).toMatch(/Install a LaTeX distribution/);
  });

  it("uses the given file stem for the files it writes", async () => {
    const directory = await makeDirectory();
    const runner = fakeRunner({
      pdflatex: async (_args, cwd) => {
        const log = "Output written on Alex.pdf (1 page, 10 bytes).";
        await writeFile(path.join(cwd, "Alex.log"), log);
        return { exitCode: 0, output: log };
      },
    });
    const result = await compileResume("x", directory, runner, "Alex");
    expect(result.pdfPath).toBe(path.join(directory, "Alex.pdf"));
  });
});
