import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, main, readVersion } from "./index.js";

describe("scout version", () => {
  it("prints the version from package.json", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    await buildProgram().parseAsync(["node", "scout", "version"]);
    spy.mockRestore();
    expect(lines).toEqual([readVersion()]);
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("scout command tree", () => {
  it("lists every command the product offers", () => {
    const names = buildProgram().commands.map((command) => command.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "version",
        "init",
        "profile",
        "resume",
        "boards",
        "discover",
        "jobs",
        "digest",
        "serve",
        "pause",
        "unpause",
      ]),
    );
  });
});

describe("main", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "scout-index-"));
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("prints a ScoutError as its full sentence and sets the exit code for that kind of error", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      errors.push(line);
    });
    await main(["node", "scout", "profile", "show"], { directory });
    expect(process.exitCode).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\.$/);
  });

  it("keeps the parser's own message and a non-zero exit code for an unknown command", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await main(["node", "scout", "nonsense"], { directory });
    expect(process.exitCode).toBe(1);
  });

  it("exits with 0 after printing help", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await main(["node", "scout", "--help"], { directory });
    expect(process.exitCode).toBe(0);
  });
});
