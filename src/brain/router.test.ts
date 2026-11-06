/** Tests for `createBrainRouter`: cache, budget, fallback and degraded mode. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Brain, BrainRequest, BrainResult } from "../shared/index.js";
import { createDailyBudget, createFileDailyBudget } from "./budget.js";
import { createFileCache, createMemoryCache } from "./cache.js";
import { createFakeBrain } from "./fake-brain.js";
import { buildCacheKey, createBrainRouter } from "./router.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Reply shape, request and clock shared by the router tests. */
const schema = z.object({ score: z.number() });
const request: BrainRequest<{ score: number }> = {
  task: "score",
  instructions: "Score the job.",
  untrustedText: "A backend role.",
  schema,
};
const fixedNow = (): Date => new Date("2026-11-07T10:00:00.000Z");

/** An engine that counts its calls and answers with a fixed score. */
function countingEngine(name: string): Brain & { calls: number } {
  const engine = {
    name,
    calls: 0,
    async run<T>(): Promise<BrainResult<T>> {
      engine.calls += 1;
      return { ok: true, value: { score: 7 } as T, engine: name, cached: false };
    },
  };
  return engine;
}

/** Builds a router with an in-memory cache and budget around the given engines. */
function makeRouter(primary: Brain, extra: { fallback?: Brain; limitPerDay?: number } = {}) {
  return createBrainRouter({
    primary,
    ...(extra.fallback ? { fallback: extra.fallback } : {}),
    budget: createDailyBudget({ limitPerDay: extra.limitPerDay ?? 100, now: fixedNow }),
    cache: createMemoryCache(),
    profileVersion: 1,
    now: fixedNow,
  });
}

describe("router cache", () => {
  it("never calls the engine twice for the same input", async () => {
    const engine = countingEngine("claude");
    const router = makeRouter(engine);
    const first = await router.run(request);
    const second = await router.run(request);
    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true, engine: "claude", value: { score: 7 } });
    expect(engine.calls).toBe(1);
  });

  it("shares one engine call between identical requests made at the same time", async () => {
    const engine = countingEngine("claude");
    const router = makeRouter(engine);
    await Promise.all([router.run(request), router.run(request), router.run(request)]);
    expect(engine.calls).toBe(1);
  });

  it("calls the engine again when the untrusted text, instructions or task change", async () => {
    const engine = countingEngine("claude");
    const router = makeRouter(engine);
    await router.run(request);
    await router.run({ ...request, untrustedText: "A different role." });
    await router.run({ ...request, instructions: "Score it differently." });
    await router.run({ ...request, task: "other" });
    expect(engine.calls).toBe(4);
  });

  it("includes the schema and the profile version in the key", () => {
    const base = buildCacheKey(request, 1);
    expect(buildCacheKey(request, 2)).not.toBe(base);
    expect(buildCacheKey({ ...request, schema: z.object({ score: z.string() }) }, 1)).not.toBe(
      base,
    );
    expect(buildCacheKey(request, 1)).toBe(base);
  });

  it("does not cache failures and does not spend budget on cache hits", async () => {
    const engine = countingEngine("claude");
    const budget = createDailyBudget({ limitPerDay: 1, now: fixedNow });
    const router = createBrainRouter({
      primary: engine,
      budget,
      cache: createMemoryCache(),
      profileVersion: 1,
      now: fixedNow,
    });
    await router.run(request);
    expect(await router.run(request)).toMatchObject({ ok: true, cached: true });
    expect(await router.run(request)).toMatchObject({ ok: true, cached: true });
    expect(engine.calls).toBe(1);
  });

  it("caches replies of schemas that transform their input", async () => {
    const transformed = z.object({ score: z.string().transform(Number) });
    const engine = {
      name: "claude",
      calls: 0,
      async run<T>(): Promise<BrainResult<T>> {
        engine.calls += 1;
        return { ok: true, value: { score: 7 } as T, engine: "claude", cached: false };
      },
    };
    const router = makeRouter(engine);
    await router.run({ ...request, schema: transformed });
    const second = await router.run({ ...request, schema: transformed });
    expect(second).toMatchObject({ ok: true, cached: true, value: { score: 7 } });
    expect(engine.calls).toBe(1);
  });

  it("keeps replies across restarts with the file cache", async () => {
    const folder = await mkdtemp(join(tmpdir(), "scout-brain-router-"));
    try {
      const first = countingEngine("claude");
      await createBrainRouter({
        primary: first,
        budget: createDailyBudget({ limitPerDay: 5, now: fixedNow }),
        cache: createFileCache(folder),
        profileVersion: 1,
      }).run(request);
      const second = countingEngine("claude");
      const result = await createBrainRouter({
        primary: second,
        budget: createDailyBudget({ limitPerDay: 5, now: fixedNow }),
        cache: createFileCache(folder),
        profileVersion: 1,
      }).run(request);
      expect(result).toMatchObject({ ok: true, cached: true });
      expect(second.calls).toBe(0);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("still returns a reply when the cache cannot be written", async () => {
    const router = createBrainRouter({
      primary: countingEngine("claude"),
      budget: createDailyBudget({ limitPerDay: 5, now: fixedNow }),
      cache: {
        get: async () => undefined,
        set: async () => {
          throw new Error("disk full");
        },
      },
      profileVersion: 1,
    });
    expect(await router.run(request)).toMatchObject({ ok: true });
  });
});

describe("router budget", () => {
  it("refuses with 'daily model call budget used' and the next midnight UTC, then resets", async () => {
    let moment = new Date("2026-11-07T22:00:00.000Z");
    const engine = countingEngine("claude");
    const router = createBrainRouter({
      primary: engine,
      budget: createDailyBudget({ limitPerDay: 2, now: () => moment }),
      cache: createMemoryCache(),
      profileVersion: 1,
      now: () => moment,
    });
    await router.run({ ...request, task: "a" });
    await router.run({ ...request, task: "b" });
    const refused = await router.run({ ...request, task: "c" });
    expect(refused).toEqual({
      ok: false,
      reason: "limit-reached",
      message: "daily model call budget used",
      resetAt: "2026-11-08T00:00:00.000Z",
    });
    expect(engine.calls).toBe(2);

    moment = new Date("2026-11-08T00:00:01.000Z");
    expect(await router.run({ ...request, task: "c" })).toMatchObject({ ok: true });
    expect(engine.calls).toBe(3);
  });

  it("shares the count between runs with the file budget", async () => {
    const folder = await mkdtemp(join(tmpdir(), "scout-brain-router-"));
    try {
      const build = () =>
        createBrainRouter({
          primary: countingEngine("claude"),
          budget: createFileDailyBudget(folder, { limitPerDay: 1, now: fixedNow }),
          cache: createMemoryCache(),
          profileVersion: 1,
          now: fixedNow,
        });
      expect(await build().run(request)).toMatchObject({ ok: true });
      expect(await build().run(request)).toMatchObject({
        ok: false,
        message: "daily model call budget used",
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("does not count a call that ended in a limit", async () => {
    const limited = createFakeBrain([{ kind: "limit-reached" }], "claude");
    const working = countingEngine("codex");
    const router = makeRouter(limited, { fallback: working, limitPerDay: 1 });
    expect(await router.run(request)).toMatchObject({ ok: true, engine: "codex" });
    expect(await router.run({ ...request, task: "again" })).toMatchObject({
      ok: false,
      message: "daily model call budget used",
    });
  });
});

describe("router fallback and degraded mode", () => {
  it("uses the fallback engine when the main one reports a limit", async () => {
    const primary = createFakeBrain(
      [{ kind: "limit-reached", resetAt: "2026-11-07T12:00:00.000Z" }],
      "claude",
    );
    const fallback = createFakeBrain([{ kind: "value", value: { score: 4 } }], "codex");
    const result = await makeRouter(primary, { fallback }).run(request);
    expect(result).toEqual({ ok: true, value: { score: 4 }, engine: "codex", cached: false });
  });

  it("uses the fallback engine when the main one is unavailable", async () => {
    const primary = createFakeBrain([{ kind: "unavailable" }], "claude");
    const fallback = createFakeBrain([{ kind: "value", value: { score: 4 } }], "codex");
    expect(await makeRouter(primary, { fallback }).run(request)).toMatchObject({
      ok: true,
      engine: "codex",
    });
  });

  it("returns the failure straight away when every engine is limited, with the earliest reset", async () => {
    const primary = createFakeBrain(
      [{ kind: "limit-reached", resetAt: "2026-11-07T14:00:00.000Z" }],
      "claude",
    );
    const fallback = createFakeBrain(
      [{ kind: "limit-reached", resetAt: "2026-11-07T12:00:00.000Z" }],
      "codex",
    );
    const result = await makeRouter(primary, { fallback }).run(request);
    expect(result).toMatchObject({
      ok: false,
      reason: "limit-reached",
      resetAt: "2026-11-07T12:00:00.000Z",
    });
  });

  it("returns unavailable when every engine is unavailable", async () => {
    const primary = createFakeBrain([], "claude");
    const fallback = createFakeBrain([], "codex");
    expect(await makeRouter(primary, { fallback }).run(request)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns invalid output without trying the fallback", async () => {
    const primary = createFakeBrain(
      [
        { kind: "text", text: "no" },
        { kind: "text", text: "no" },
      ],
      "claude",
    );
    const fallback = createFakeBrain([{ kind: "value", value: { score: 1 } }], "codex");
    const result = await makeRouter(primary, { fallback }).run(request);
    expect(result).toMatchObject({ ok: false, reason: "invalid-output" });
    expect(fallback.remainingReplies()).toBe(1);
  });
});
