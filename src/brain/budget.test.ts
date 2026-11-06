import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDailyBudget, createFileDailyBudget, nextUtcMidnight } from "./budget.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("daily budget", () => {
  it("allows the limit and then refuses until midnight UTC", async () => {
    let moment = new Date("2026-11-07T23:00:00.000Z");
    const budget = createDailyBudget({ limitPerDay: 2, now: () => moment });
    expect((await budget.take()).allowed).toBe(true);
    expect((await budget.take()).allowed).toBe(true);
    expect((await budget.take()).allowed).toBe(false);

    moment = new Date("2026-11-08T00:00:00.000Z");
    expect((await budget.take()).allowed).toBe(true);
  });

  it("gives a call back so it can be spent again", async () => {
    const budget = createDailyBudget({
      limitPerDay: 1,
      now: () => new Date("2026-11-07T10:00:00Z"),
    });
    const first = await budget.take();
    if (!first.allowed) throw new Error("expected the first call to be allowed");
    await first.giveBack();
    expect((await budget.take()).allowed).toBe(true);
  });

  it("never lets simultaneous requests spend more than the limit", async () => {
    const budget = createDailyBudget({
      limitPerDay: 2,
      now: () => new Date("2026-11-07T10:00:00Z"),
    });
    const takes = await Promise.all([1, 2, 3, 4, 5].map(() => budget.take()));
    expect(takes.filter((take) => take.allowed)).toHaveLength(2);
  });

  it("rejects a limit that is not a whole number of at least 1", () => {
    expect(() => createDailyBudget({ limitPerDay: 0 })).toThrow(/whole number/);
    expect(() => createDailyBudget({ limitPerDay: 1.5 })).toThrow(/whole number/);
  });

  it("finds the next midnight UTC", () => {
    expect(nextUtcMidnight(new Date("2026-11-07T10:00:00Z")).toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    );
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("keeps the count between runs when file-backed", async () => {
    const folder = await mkdtemp(join(tmpdir(), "scout-brain-budget-"));
    folders.push(folder);
    const now = (): Date => new Date("2026-11-07T10:00:00Z");
    const first = createFileDailyBudget(folder, { limitPerDay: 2, now });
    await first.take();
    await first.take();
    const reopened = createFileDailyBudget(folder, { limitPerDay: 2, now });
    expect((await reopened.take()).allowed).toBe(false);
  });
});
