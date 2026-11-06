/** Tests for the real process runner, using the Node program itself (no network, no model). */
import { describe, expect, it } from "vitest";
import { createProcessRunner } from "./process-runner.js";

/** The test starts the Node program itself (no network, no model) to exercise the real runner. */
const node = process.execPath;

describe("createProcessRunner", () => {
  it("collects output, error output and the exit code, and passes input", async () => {
    const run = createProcessRunner();
    const result = await run(
      node,
      [
        "-e",
        "process.stdin.on('data', d => { process.stdout.write('got:' + d); process.stderr.write('e'); process.exit(3); })",
      ],
      "hello",
    );
    expect(result).toEqual({ stdout: "got:hello", stderr: "e", exitCode: 3 });
  });

  it("rejects when the program does not exist", async () => {
    const run = createProcessRunner();
    await expect(run("scout-no-such-program-xyz", [], "")).rejects.toThrow();
  });

  it("kills a program that prints more than the output cap", async () => {
    const run = createProcessRunner({ maxOutputBytes: 1000 });
    await expect(
      run(node, ["-e", "setInterval(() => process.stdout.write('x'.repeat(500)), 1)"], ""),
    ).rejects.toThrow(/more than 1000 bytes/);
  });

  it("kills a program that runs past the timeout", async () => {
    const run = createProcessRunner({ timeoutMilliseconds: 200 });
    await expect(run(node, ["-e", "setInterval(() => {}, 1000)"], "")).rejects.toThrow(
      /longer than 200 ms/,
    );
  });
});
