import { describe, expect, it } from "vitest";
import type { ActionLogEntry, JobRecord } from "../shared/index.js";
import { makeJobRecord, makePosting, openTestStore } from "../../fixtures/mail/builders.js";
import { AGE_BUCKETS, ageBucketOf, buildFunnel } from "./funnel.js";

/** A transition line as the store writes it. */
function transition(jobId: string, from: string, to: string, at: string): ActionLogEntry {
  return { at, actor: "store", action: "transition", jobId, detail: `${from} -> ${to}: test` };
}

describe("buildFunnel", () => {
  it("counts each stage from current statuses", () => {
    const jobs: JobRecord[] = [
      makeJobRecord({ id: "a", status: "found" }),
      makeJobRecord({ id: "b", status: "shortlisted" }),
      makeJobRecord({ id: "c", status: "applied" }),
      makeJobRecord({ id: "d", status: "contacted" }),
      makeJobRecord({ id: "e", status: "interviewing" }),
      makeJobRecord({ id: "f", status: "offer" }),
      makeJobRecord({ id: "g", status: "skipped" }),
    ];
    expect(buildFunnel(jobs, []).total).toEqual({
      discovered: 7,
      shortlisted: 5,
      applied: 4,
      replied: 3,
      interviewing: 1,
      offered: 1,
    });
  });

  it("uses the log to remember stages a job passed through", () => {
    const jobs = [makeJobRecord({ id: "a", status: "rejected" })];
    const log = [
      transition("a", "applied", "interviewing", "2026-11-03T00:00:00.000Z"),
      transition("a", "interviewing", "rejected", "2026-11-05T00:00:00.000Z"),
    ];
    const { total } = buildFunnel(jobs, log);
    expect(total).toMatchObject({ applied: 1, replied: 1, interviewing: 1, offered: 0 });
  });

  it("breaks counts down by board kind, and the parts add up to the total", () => {
    const jobs = [
      makeJobRecord({ id: "a", board: "greenhouse", status: "applied" }),
      makeJobRecord({ id: "b", board: "greenhouse", status: "interviewing" }),
      makeJobRecord({ id: "c", board: "lever", status: "applied" }),
      makeJobRecord({ id: "d", board: "feed", status: "found" }),
    ];
    const funnel = buildFunnel(jobs, []);
    expect(funnel.byBoard.greenhouse).toMatchObject({ discovered: 2, applied: 2, interviewing: 1 });
    expect(funnel.byBoard.lever).toMatchObject({ discovered: 1, applied: 1 });
    expect(funnel.byBoard.feed).toMatchObject({ discovered: 1, applied: 0 });
    expect(funnel.byBoard.ashby).toBeUndefined();
    const sum = Object.values(funnel.byBoard).reduce(
      (count, counts) => count + (counts?.discovered ?? 0),
      0,
    );
    expect(sum).toBe(funnel.total.discovered);
  });

  it("buckets applications by posting age at apply time", () => {
    const jobs = [
      makeJobRecord({ id: "a", status: "applied", postedAt: "2026-11-01T00:00:00.000Z" }),
      makeJobRecord({ id: "b", status: "interviewing", postedAt: "2026-10-20T00:00:00.000Z" }),
      makeJobRecord({ id: "c", status: "applied" }),
      makeJobRecord({ id: "d", status: "found", postedAt: "2026-11-01T00:00:00.000Z" }),
    ];
    const log = [
      transition("a", "submitting", "applied", "2026-11-02T00:00:00.000Z"),
      transition("b", "submitting", "applied", "2026-11-02T00:00:00.000Z"),
      transition("c", "submitting", "applied", "2026-11-02T00:00:00.000Z"),
    ];
    const { byPostingAge } = buildFunnel(jobs, log);
    expect(byPostingAge["0-2 days"]).toEqual({ applied: 1, replied: 0 });
    expect(byPostingAge["8-14 days"]).toEqual({ applied: 1, replied: 1 });
    expect(byPostingAge.unknown).toEqual({ applied: 1, replied: 0 });
    expect(Object.keys(byPostingAge)).toEqual([...AGE_BUCKETS]);
  });

  it("is pure: the same input gives the same output and the input is not changed", () => {
    const jobs = [makeJobRecord({ id: "a" })];
    const log = [transition("a", "submitting", "applied", "2026-11-02T00:00:00.000Z")];
    const before = JSON.stringify([jobs, log]);
    expect(buildFunnel(jobs, log)).toEqual(buildFunnel(jobs, log));
    expect(JSON.stringify([jobs, log])).toBe(before);
  });

  it("an empty input gives all zeros", () => {
    const funnel = buildFunnel([], []);
    expect(funnel.total).toEqual({
      discovered: 0,
      shortlisted: 0,
      applied: 0,
      replied: 0,
      interviewing: 0,
      offered: 0,
    });
    expect(funnel.byBoard).toEqual({});
  });

  it("works on the real store's own log lines", () => {
    let minutes = 0;
    const store = openTestStore(() => new Date(Date.UTC(2026, 10, 2, 0, minutes++)));
    try {
      const job = store.addAppliedJob({ postedAt: "2026-11-01T00:00:00.000Z" });
      store.jobStore.transition(job.id, "interviewing", "email");
      store.jobStore.upsertPosting(makePosting({ id: "other", board: "lever" }));
      const funnel = buildFunnel(store.jobStore.list(), store.actionLog.recent(100));
      expect(funnel.total).toMatchObject({ discovered: 2, applied: 1, interviewing: 1 });
      expect(funnel.byPostingAge["0-2 days"].applied).toBe(1);
    } finally {
      store.remove();
    }
  });
});

describe("ageBucketOf", () => {
  it("puts the edges in the right buckets", () => {
    const applied = "2026-11-20T00:00:00.000Z";
    expect(ageBucketOf("2026-11-18T00:00:00.000Z", applied)).toBe("0-2 days");
    expect(ageBucketOf("2026-11-17T00:00:00.000Z", applied)).toBe("3-7 days");
    expect(ageBucketOf("2026-11-13T00:00:00.000Z", applied)).toBe("3-7 days");
    expect(ageBucketOf("2026-11-12T00:00:00.000Z", applied)).toBe("8-14 days");
    expect(ageBucketOf("2026-11-06T00:00:00.000Z", applied)).toBe("8-14 days");
    expect(ageBucketOf("2026-11-05T00:00:00.000Z", applied)).toBe("15+ days");
  });

  it("is unknown for missing or unreadable dates", () => {
    expect(ageBucketOf(undefined, "2026-11-20T00:00:00.000Z")).toBe("unknown");
    expect(ageBucketOf("2026-11-01T00:00:00.000Z", undefined)).toBe("unknown");
    expect(ageBucketOf("not a date", "2026-11-20T00:00:00.000Z")).toBe("unknown");
  });
});
