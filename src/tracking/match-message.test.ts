import { describe, expect, it } from "vitest";
import { loadFixtureMessage, makeJobRecord, openTestStore } from "../../fixtures/mail/builders.js";
import { applyOutcome } from "./apply-outcome.js";
import { matchMessageToJob } from "./match-message.js";
import { trackMessages } from "./track-messages.js";
import { createFakeBrain } from "../brain/index.js";
import type { JobStatus } from "../shared/index.js";

const northwind = makeJobRecord({
  id: "northwind",
  company: "Northwind Labs",
  title: "Backend Engineer",
});
const harborBackend = makeJobRecord({
  id: "harbor-backend",
  company: "Harbor Systems",
  title: "Backend Engineer",
});
const harborFrontend = makeJobRecord({
  id: "harbor-frontend",
  company: "Harbor Systems",
  title: "Frontend Engineer",
});
const lakeside = makeJobRecord({
  id: "lakeside",
  company: "Lakeside Software",
  title: "Platform Engineer",
});

describe("matchMessageToJob", () => {
  it("matches by company in the sender domain and role words", async () => {
    const result = await loadFixtureMessage("rejection").then((message) =>
      matchMessageToJob(message, [northwind, harborBackend, lakeside]),
    );
    expect(result).toMatchObject({ kind: "matched", jobId: "northwind" });
  });

  it("uses the role to choose between two jobs at the same company", async () => {
    const message = await loadFixtureMessage("interview-invite");
    const result = matchMessageToJob(message, [harborBackend, harborFrontend]);
    expect(result).toMatchObject({ kind: "matched", jobId: "harbor-backend" });
  });

  it("never guesses between two equally likely jobs: it lists both candidates", async () => {
    const message = await loadFixtureMessage("same-company-two-roles");
    const result = matchMessageToJob(message, [harborBackend, harborFrontend]);
    expect(result.kind).toBe("unmatched");
    if (result.kind === "unmatched") {
      expect(result.candidates.map((candidate) => candidate.jobId).sort()).toEqual([
        "harbor-backend",
        "harbor-frontend",
      ]);
    }
  });

  it("is unmatched, with no candidates, when no job's company appears", async () => {
    const message = await loadFixtureMessage("recruiter");
    expect(matchMessageToJob(message, [northwind, lakeside])).toEqual({
      kind: "unmatched",
      candidates: [],
    });
  });

  it("matches an HTML-only message by company and role in the text", async () => {
    const message = await loadFixtureMessage("html-only-rejection");
    expect(matchMessageToJob(message, [northwind, lakeside])).toMatchObject({
      kind: "matched",
      jobId: "lakeside",
    });
  });

  it("ignores jobs that were never applied for", async () => {
    const message = await loadFixtureMessage("rejection");
    const notApplied = makeJobRecord({ ...northwind, status: "shortlisted" });
    expect(matchMessageToJob(message, [notApplied]).kind).toBe("unmatched");
  });

  it("does not match on a company name that only appears inside another word", async () => {
    const message = await loadFixtureMessage("rejection");
    const similar = makeJobRecord({ id: "x", company: "Wind", title: "Backend Engineer" });
    expect(matchMessageToJob(message, [similar]).kind).toBe("unmatched");
  });
});

describe("applyOutcome with the real job store", () => {
  /** Applies `kind` to a fresh applied job and returns the result and the stored status. */
  function applyTo(kind: Parameters<typeof applyOutcome>[2], moveFirst: JobStatus[] = []) {
    const store = openTestStore();
    try {
      const job = store.addAppliedJob();
      for (const status of moveFirst) store.jobStore.transition(job.id, status, "setup");
      const result = applyOutcome(store.jobStore, job.id, kind, "email");
      return { result, status: store.jobStore.get(job.id)?.status, log: store.actionLog.recent(5) };
    } finally {
      store.remove();
    }
  }

  it("application received changes nothing", () => {
    const { result, status } = applyTo("application-received");
    expect(result.changed).toBe(false);
    expect(status).toBe("applied");
  });

  it("interview invite moves applied to interviewing, and the log records it", () => {
    const { result, status, log } = applyTo("interview-invite");
    expect(result).toMatchObject({ changed: true, from: "applied", to: "interviewing" });
    expect(status).toBe("interviewing");
    expect(log[0]?.detail).toContain("applied -> interviewing");
  });

  it("rejection moves applied to rejected", () => {
    expect(applyTo("rejection").status).toBe("rejected");
  });

  it("recruiter message moves applied to contacted", () => {
    expect(applyTo("recruiter-message").status).toBe("contacted");
  });

  it("recruiter message does not change a job that is already interviewing", () => {
    const { result, status } = applyTo("recruiter-message", ["interviewing"]);
    expect(result.changed).toBe(false);
    expect(status).toBe("interviewing");
  });

  it("assessment, other and ambiguous never change a status", () => {
    for (const kind of ["assessment", "other", "ambiguous"] as const) {
      expect(applyTo(kind).status).toBe("applied");
    }
  });

  it("an offer from interviewing moves to offer", () => {
    expect(applyTo("offer", ["interviewing"]).status).toBe("offer");
  });

  it("reports an illegal move instead of forcing it (applied cannot jump to offer)", () => {
    const { result, status } = applyTo("offer");
    expect(result).toMatchObject({ changed: false, reason: "illegal-transition" });
    expect(status).toBe("applied");
  });

  it("leaves a job alone that is already at the target status", () => {
    const { result } = applyTo("rejection", ["rejected"]);
    expect(result).toMatchObject({ changed: false, reason: "already-there" });
  });

  it("reports an unknown job as not-found", () => {
    const store = openTestStore();
    try {
      expect(() => applyOutcome(store.jobStore, "missing", "offer", "x")).toThrowError(
        expect.objectContaining({ code: "not-found" }),
      );
    } finally {
      store.remove();
    }
  });
});

describe("trackMessages", () => {
  it("matches, classifies and moves the right job, writing only kind and id to the log", async () => {
    const store = openTestStore();
    try {
      const harbor = store.addAppliedJob({
        id: "harbor",
        company: "Harbor Systems",
        title: "Backend Engineer",
      });
      const northwindJob = store.addAppliedJob({
        id: "northwind",
        company: "Northwind Labs",
        title: "Backend Engineer",
      });
      const messages = [
        await loadFixtureMessage("interview-invite"),
        await loadFixtureMessage("rejection"),
      ];
      const tracked = await trackMessages({
        messages,
        jobStore: store.jobStore,
        actionLog: store.actionLog,
      });
      expect(tracked.map((entry) => entry.outcome?.changed)).toEqual([true, true]);
      expect(store.jobStore.get(harbor.id)?.status).toBe("interviewing");
      expect(store.jobStore.get(northwindJob.id)?.status).toBe("rejected");
      const trackingLines = store.actionLog.recent(20).filter((line) => line.actor === "tracking");
      expect(trackingLines).toHaveLength(2);
      for (const line of trackingLines) {
        expect(line.detail).not.toContain("Alex");
      }
    } finally {
      store.remove();
    }
  });

  it("an unmatched message changes nothing and is reported", async () => {
    const store = openTestStore();
    try {
      const job = store.addAppliedJob();
      const tracked = await trackMessages({
        messages: [await loadFixtureMessage("recruiter")],
        jobStore: store.jobStore,
      });
      expect(tracked[0]?.match.kind).toBe("unmatched");
      expect(tracked[0]?.outcome).toBeUndefined();
      expect(store.jobStore.get(job.id)?.status).toBe("applied");
    } finally {
      store.remove();
    }
  });

  it("an email telling Scout to mark every job as offer changes no job, even with a model that would obey", async () => {
    const store = openTestStore();
    try {
      const quayside = store.addAppliedJob({
        id: "quayside",
        company: "Quayside Digital",
        title: "Data Engineer",
      });
      const harbor = store.addAppliedJob({
        id: "harbor",
        company: "Harbor Systems",
        title: "Backend Engineer",
      });
      const northwindJob = store.addAppliedJob({
        id: "northwind",
        company: "Northwind Labs",
        title: "Backend Engineer",
      });
      const obedient = createFakeBrain([
        { kind: "value", value: { kind: "offer", confidence: 1, reason: "the email says so" } },
      ]);
      const tracked = await trackMessages({
        messages: [await loadFixtureMessage("injection")],
        jobStore: store.jobStore,
        brain: obedient,
        actionLog: store.actionLog,
      });
      expect(tracked[0]?.classification.kind).toBe("other");
      for (const id of [quayside.id, harbor.id, northwindJob.id]) {
        expect(store.jobStore.get(id)?.status).toBe("applied");
      }
      expect(store.actionLog.recent(50).some((line) => line.actor === "tracking")).toBe(false);
    } finally {
      store.remove();
    }
  });

  it("does not apply an ambiguous message the model could not settle", async () => {
    const store = openTestStore();
    try {
      const job = store.addAppliedJob({
        id: "quayside",
        company: "Quayside Digital",
        title: "Data Engineer",
      });
      const tracked = await trackMessages({
        messages: [await loadFixtureMessage("ambiguous")],
        jobStore: store.jobStore,
      });
      expect(tracked[0]?.classification.kind).toBe("ambiguous");
      expect(tracked[0]?.outcome).toBeUndefined();
      expect(store.jobStore.get(job.id)?.status).toBe("applied");
    } finally {
      store.remove();
    }
  });

  it("runs the whole fixture set: every reply matches the right job or is shown unmatched", async () => {
    const store = openTestStore();
    try {
      store.addAppliedJob({
        id: "northwind",
        company: "Northwind Labs",
        title: "Backend Engineer",
      });
      store.addAppliedJob({
        id: "lakeside",
        company: "Lakeside Software",
        title: "Platform Engineer",
      });
      const names = ["received", "assessment", "rejection", "recruiter", "html-only-rejection"];
      const messages = await Promise.all(names.map((name) => loadFixtureMessage(name)));
      const tracked = await trackMessages({ messages, jobStore: store.jobStore });
      const matchedIds = tracked.map((entry) =>
        entry.match.kind === "matched" ? entry.match.jobId : "unmatched",
      );
      expect(matchedIds).toEqual(["northwind", "lakeside", "northwind", "unmatched", "lakeside"]);
    } finally {
      store.remove();
    }
  });
});
