import { afterEach, describe, expect, it } from "vitest";
import { createFakeBrain } from "../brain/index.js";
import type { Brain, Discovery, Posting } from "../shared/index.js";
import { runDiscoveryPass } from "./discovery-pass.js";
import { DEGRADED_SHORTLIST_LIMIT } from "./shortlist.js";
import {
  makeNumberedPosting,
  makeScriptedBrain,
  makeTestApplication,
  type TestApplication,
} from "./test-helpers.js";

let current: TestApplication | undefined;

afterEach(() => {
  current?.cleanUp();
  current = undefined;
});

/** Starts a test application whose one board returns `postings` and whose brain is `brain`. */
function start(postings: Posting[], brain: Brain, installProfile = true): TestApplication {
  current = makeTestApplication(postings, { brain }, installProfile);
  return current;
}

describe("runDiscoveryPass: hard rules", () => {
  it("records each dropped posting as skipped with its reasons", async () => {
    const senior = makeNumberedPosting(1, { seniority: "senior" });
    const { application } = start(
      [senior, makeNumberedPosting(2)],
      makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 })),
    );
    const summary = await runDiscoveryPass(application);
    expect(summary.droppedByRules).toBe(1);
    const job = application.jobStore.get(senior.id);
    expect(job?.status).toBe("skipped");
    expect(job?.statusReason).toMatch(/senior/);
  });

  it("never drops or changes a job that is already past found when it is seen again", async () => {
    const posting = makeNumberedPosting(1);
    const { application } = start(
      [posting],
      makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 })),
    );
    await runDiscoveryPass(application);
    expect(application.jobStore.get(posting.id)?.status).toBe("shortlisted");
    await runDiscoveryPass(application);
    expect(application.jobStore.get(posting.id)?.status).toBe("shortlisted");
  });

  it("reports a board that fails and carries on with the others", async () => {
    const failing: Discovery = {
      fetchBoard: async (board) => {
        if (board.token === "broken") throw new Error("The broken board answered with HTTP 500.");
        return [makeNumberedPosting(1)];
      },
    };
    current = makeTestApplication([], {
      discovery: failing,
      brain: makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 })),
    });
    current.application.boardStore.add({ kind: "greenhouse", token: "broken" });
    const summary = await runDiscoveryPass(current.application);
    expect(summary.boardsFailed).toEqual([
      { board: "greenhouse:broken", message: "The broken board answered with HTTP 500." },
    ]);
    expect(summary.boardsRead).toBe(1);
    expect(summary.shortlisted).toBe(1);
  });
});

describe("runDiscoveryPass: scoring", () => {
  it("sends each job to a band: shortlisted, kept for review, or skipped with a reason", async () => {
    const scores: Record<string, { eligibility: number; desirability: number }> = {
      "posting-1": { eligibility: 90, desirability: 90 },
      "posting-2": { eligibility: 70, desirability: 65 },
      "posting-3": { eligibility: 30, desirability: 90 },
    };
    const { application } = start(
      [1, 2, 3].map((number) => makeNumberedPosting(number)),
      makeScriptedBrain((id) => scores[id]),
    );
    const summary = await runDiscoveryPass(application);
    expect(summary).toMatchObject({
      mode: "model",
      scoredByModel: 3,
      shortlisted: 1,
      keptForReview: 1,
      skippedByScore: 1,
      waitingForScoring: 0,
    });
    expect(application.jobStore.get("posting-1")?.status).toBe("shortlisted");
    expect(application.jobStore.get("posting-2")?.status).toBe("found");
    expect(application.jobStore.get("posting-3")?.status).toBe("skipped");
    expect(application.jobStore.get("posting-3")?.statusReason).toMatch(/Low fit/);
  });

  it("keeps a job with an unknown hard requirement for review whatever its score", async () => {
    const { application } = start(
      [makeNumberedPosting(1)],
      makeScriptedBrain(() => ({
        eligibility: 100,
        desirability: 100,
        unknownRequirements: ["Security clearance"],
      })),
    );
    const summary = await runDiscoveryPass(application);
    expect(summary.keptForReview).toBe(1);
    expect(application.jobStore.get("posting-1")?.status).toBe("found");
  });

  it("never asks the model about a job it already scored for this profile version", async () => {
    const brain = makeScriptedBrain(() => ({ eligibility: 70, desirability: 65 }));
    const { application } = start([makeNumberedPosting(1)], brain);
    await runDiscoveryPass(application);
    await runDiscoveryPass(application);
    expect(brain.batches).toHaveLength(1);
  });

  it("asks again after the profile changed, because the stored score is for the old version", async () => {
    const brain = makeScriptedBrain(() => ({ eligibility: 70, desirability: 65 }));
    const { application } = start([makeNumberedPosting(1)], brain);
    await runDiscoveryPass(application);
    const profile = application.profileStore.load();
    application.profileStore.save({
      ...profile,
      summary: { ...profile.summary, text: `${profile.summary.text} Changed.` },
    });
    await runDiscoveryPass(application);
    expect(brain.batches).toHaveLength(2);
  });

  it("puts at most 20 postings in one request", async () => {
    const postings = Array.from({ length: 25 }, (_, index) => makeNumberedPosting(index + 1));
    const brain = makeScriptedBrain(() => ({ eligibility: 70, desirability: 65 }));
    const { application } = start(postings, brain);
    await runDiscoveryPass(application);
    expect(brain.batches.map((batch) => batch.length)).toEqual([20, 5]);
  });

  it("leaves a job found, with a note, when the model gives no score for it", async () => {
    const { application } = start(
      [makeNumberedPosting(1), makeNumberedPosting(2)],
      makeScriptedBrain((id) =>
        id === "posting-1" ? { eligibility: 90, desirability: 90 } : undefined,
      ),
    );
    const summary = await runDiscoveryPass(application);
    expect(summary.mode).toBe("model");
    expect(summary.waitingForScoring).toBe(1);
    expect(application.jobStore.get("posting-2")?.status).toBe("found");
  });

  it("does not switch to degraded mode for a reply in the wrong shape", async () => {
    const brain = createFakeBrain([
      { kind: "text", text: "not json" },
      { kind: "text", text: "still not json" },
    ]);
    const { application } = start([makeNumberedPosting(1)], brain);
    const summary = await runDiscoveryPass(application);
    expect(summary.mode).toBe("model");
    expect(summary.reasons.join(" ")).toMatch(/not in the expected shape/);
    expect(application.jobStore.get("posting-1")?.status).toBe("found");
  });
});

describe("runDiscoveryPass: degraded mode", () => {
  it("shortlists on keyword score alone, and says so, when the limit is reached", async () => {
    const brain = createFakeBrain([{ kind: "limit-reached", resetAt: "2026-11-08T00:00:00.000Z" }]);
    const strong = makeNumberedPosting(1);
    const weak = makeNumberedPosting(2, {
      skills: ["COBOL"],
      title: "Mainframe Engineer 2",
      description: "Maintain COBOL batch jobs.",
    });
    const { application } = start([strong, weak], brain);
    const summary = await runDiscoveryPass(application);
    expect(summary.mode).toBe("degraded");
    expect(summary.reasons.join(" ")).toMatch(/usage limit was reached.*2026-11-08/);
    expect(application.jobStore.get(strong.id)?.status).toBe("shortlisted");
    expect(application.jobStore.get(strong.id)?.statusReason).toMatch(/keyword match only/);
    expect(application.jobStore.get(weak.id)?.status).toBe("found");
    expect(summary.waitingForScoring).toBe(1);
  });

  it("also degrades when the model cannot be run", async () => {
    const brain = createFakeBrain([{ kind: "unavailable", message: "claude is not installed." }]);
    const { application } = start([makeNumberedPosting(1)], brain);
    const summary = await runDiscoveryPass(application);
    expect(summary.mode).toBe("degraded");
    expect(summary.reasons.join(" ")).toMatch(/could not be used/);
  });

  it("shortlists no more than the degraded limit", async () => {
    const postings = Array.from({ length: DEGRADED_SHORTLIST_LIMIT + 5 }, (_, index) =>
      makeNumberedPosting(index + 1),
    );
    const { application } = start(postings, createFakeBrain([{ kind: "limit-reached" }]));
    const summary = await runDiscoveryPass(application);
    expect(summary.shortlisted).toBe(DEGRADED_SHORTLIST_LIMIT);
    expect(summary.waitingForScoring).toBe(5);
  });

  it("scores the jobs that waited once the model is back", async () => {
    const weak = makeNumberedPosting(2, {
      skills: ["COBOL"],
      title: "Mainframe Engineer 2",
      description: "Maintain COBOL batch jobs.",
    });
    const working = makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 }));
    const limited = createFakeBrain([{ kind: "limit-reached" }]);
    let modelIsBack = false;
    const brain: Brain = {
      name: "switching",
      run: (request) => (modelIsBack ? working.run(request) : limited.run(request)),
    };
    const { application } = start([weak], brain);
    const first = await runDiscoveryPass(application);
    expect(first.mode).toBe("degraded");
    expect(first.waitingForScoring).toBe(1);
    modelIsBack = true;
    const second = await runDiscoveryPass(application);
    expect(second.mode).toBe("model");
    expect(second.waitingForScoring).toBe(0);
    expect(application.jobStore.get(weak.id)?.status).toBe("shortlisted");
  });
});

describe("runDiscoveryPass: preconditions", () => {
  it("refuses to run without a profile and says how to get one", async () => {
    const { application } = start(
      [],
      makeScriptedBrain(() => undefined),
      false,
    );
    await expect(runDiscoveryPass(application)).rejects.toThrowError(/scout init/);
  });

  it("does not need the model when there is nothing to score", async () => {
    const { application } = start([makeNumberedPosting(1, { seniority: "senior" })], {
      name: "must-not-run",
      run: () => Promise.reject(new Error("The model must not be called.")),
    });
    const summary = await runDiscoveryPass(application);
    expect(summary.mode).toBe("model");
    expect(summary.shortlisted).toBe(0);
  });

  it("keeps working while automation is paused, because discovery does not act", async () => {
    const { application } = start(
      [makeNumberedPosting(1)],
      makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 })),
    );
    application.settingsStore.save({ ...application.settingsStore.load(), automationPaused: true });
    const summary = await runDiscoveryPass(application);
    expect(summary.shortlisted).toBe(1);
    expect(() => application.assertNotPaused()).toThrowError(/paused/);
  });
});
