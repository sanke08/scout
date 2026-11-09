/** Tests for `createCommandBrain` with a scripted runner: retry, limits, unavailable, fenced JSON. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCommandBrain } from "./command-brain.js";
import { ENGINE_CONFIGURATIONS } from "./engines.js";
import type { ProcessResult, ProcessRunner } from "./process-runner.js";

/** Reply shape and request used by every command-brain test. */
const schema = z.object({ score: z.number() });
const request = { task: "score", instructions: "Score the job.", schema };

/** A fake runner that answers with the given results in order and records each call. */
function scriptedRunner(results: Array<ProcessResult | Error>): {
  runner: ProcessRunner;
  calls: Array<{ command: string; args: readonly string[]; input: string }>;
} {
  const calls: Array<{ command: string; args: readonly string[]; input: string }> = [];
  const remaining = [...results];
  const runner: ProcessRunner = async (command, args, input) => {
    calls.push({ command, args, input });
    const next = remaining.shift();
    if (next === undefined) throw new Error("The test script ran out of replies.");
    if (next instanceof Error) throw next;
    return next;
  };
  return { runner, calls };
}

/** A successful run printing `{"score": N}`. */
const good = (score: number): ProcessResult => ({
  stdout: JSON.stringify({ score }),
  stderr: "",
  exitCode: 0,
});

describe("createCommandBrain", () => {
  it("returns a checked value for a valid reply", async () => {
    const { runner, calls } = scriptedRunner([good(7)]);
    const brain = createCommandBrain({ engine: "claude", runner });
    expect(await brain.run(request)).toEqual({
      ok: true,
      value: { score: 7 },
      engine: "claude",
      cached: false,
    });
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.args[0]).toBe("-p");
    expect(calls[0]?.input).toContain("score");
  });

  it("always pins Sonnet 5.5 and turns tools off", async () => {
    const { runner, calls } = scriptedRunner([good(1)]);
    await createCommandBrain({ engine: "claude", runner }).run(request);
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args).toContain("--tools");
    expect(Object.keys(ENGINE_CONFIGURATIONS)).toEqual(["claude"]);
  });

  it("parses JSON wrapped in prose and a code fence", async () => {
    const stdout = 'Here is the result:\n```json\n{"score": 4}\n```\nDone.';
    const { runner } = scriptedRunner([{ stdout, stderr: "", exitCode: 0 }]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: true, value: { score: 4 } });
  });

  it("rejects an invalid reply after exactly one retry, naming the problem in the retry", async () => {
    const bad = { stdout: '{"score": "high"}', stderr: "", exitCode: 0 };
    const { runner, calls } = scriptedRunner([bad, bad, good(9)]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: false, reason: "invalid-output" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toContain("CORRECTION: Your previous reply was rejected.");
    expect(calls[1]?.input).toContain("score");
  });

  it("accepts a valid retry after an invalid first reply", async () => {
    const { runner, calls } = scriptedRunner([
      { stdout: "sorry, no", stderr: "", exitCode: 0 },
      good(5),
    ]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: true, value: { score: 5 } });
    expect(calls).toHaveLength(2);
  });

  it("returns limit-reached with resetAt for a limit message and then stops calling the engine", async () => {
    let moment = new Date("2026-11-07T10:00:00.000Z");
    const { runner, calls } = scriptedRunner([
      { stdout: "", stderr: "Usage limit reached. Your limit resets in 2 hours.", exitCode: 1 },
      good(3),
    ]);
    const brain = createCommandBrain({ engine: "claude", runner, now: () => moment });

    const first = await brain.run(request);
    expect(first).toMatchObject({
      ok: false,
      reason: "limit-reached",
      resetAt: "2026-11-07T12:00:00.000Z",
    });

    moment = new Date("2026-11-07T11:00:00.000Z");
    const second = await brain.run(request);
    expect(second).toMatchObject({
      ok: false,
      reason: "limit-reached",
      resetAt: "2026-11-07T12:00:00.000Z",
    });
    expect(calls).toHaveLength(1);

    moment = new Date("2026-11-07T12:00:01.000Z");
    expect(await brain.run(request)).toMatchObject({ ok: true, value: { score: 3 } });
    expect(calls).toHaveLength(2);
  });

  it("detects a limit message printed with a zero exit code and no JSON", async () => {
    const { runner } = scriptedRunner([
      { stdout: "You have hit your usage limit.", stderr: "", exitCode: 0 },
    ]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: false, reason: "limit-reached" });
  });

  it("does not mistake a valid reply that mentions a rate limit for a limit", async () => {
    const stdout = JSON.stringify({ score: 2, note: "rate limit" });
    const { runner } = scriptedRunner([{ stdout, stderr: "", exitCode: 0 }]);
    const looseSchema = z.object({ score: z.number(), note: z.string() });
    const result = await createCommandBrain({ engine: "claude", runner }).run({
      ...request,
      schema: looseSchema,
    });
    expect(result.ok).toBe(true);
  });

  it("waits out an unknown reset for the cooldown only", async () => {
    let moment = new Date("2026-11-07T10:00:00.000Z");
    const { runner, calls } = scriptedRunner([
      { stdout: "", stderr: "rate limit exceeded", exitCode: 1 },
      good(1),
    ]);
    const brain = createCommandBrain({
      engine: "claude",
      runner,
      now: () => moment,
      unknownResetCooldownMinutes: 30,
    });
    const first = await brain.run(request);
    expect(first).toMatchObject({ ok: false, reason: "limit-reached" });
    expect(first.ok === false && first.resetAt).toBeUndefined();
    moment = new Date("2026-11-07T10:10:00.000Z");
    expect(await brain.run(request)).toMatchObject({ ok: false, reason: "limit-reached" });
    expect(calls).toHaveLength(1);
    moment = new Date("2026-11-07T10:31:00.000Z");
    expect(await brain.run(request)).toMatchObject({ ok: true });
  });

  it("returns unavailable for a non-zero exit", async () => {
    const { runner } = scriptedRunner([{ stdout: "", stderr: "boom", exitCode: 2 }]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("turns a runner that throws (missing binary, timeout, size cap) into unavailable", async () => {
    const { runner } = scriptedRunner([new Error("spawn claude ENOENT")]);
    const result = await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.ok === false && result.message).toContain("ENOENT");
  });

  it("reports unavailable for the real runner when the program is missing", async () => {
    const brain = createCommandBrain({
      engine: "claude",
      configuration: { command: "scout-no-such-program-xyz", buildArguments: () => [] },
    });
    expect(await brain.run(request)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("the prompt travels on standard input", () => {
  it("is not placed in the program's arguments, so a large request cannot hit the argument limit", async () => {
    const { runner, calls } = scriptedRunner([good(2)]);
    await createCommandBrain({ engine: "claude", runner }).run(request);
    expect(calls[0]?.args.join(" ")).not.toContain("score");
    expect(calls[0]?.input.length).toBeGreaterThan(0);
  });

  it("refuses a request larger than the cap without starting the program", async () => {
    const { runner, calls } = scriptedRunner([good(2)]);
    const huge = { ...request, untrustedText: "x".repeat(1_100_000) };
    const result = await createCommandBrain({ engine: "claude", runner }).run(huge);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
