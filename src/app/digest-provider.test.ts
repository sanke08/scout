import { afterEach, describe, expect, it } from "vitest";
import { createDigestProvider, createPendingProposals, describeResume } from "./digest-provider.js";
import { runDiscoveryPass } from "./discovery-pass.js";
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

describe("createDigestProvider", () => {
  it("returns one card per shortlisted job, best score first, with reasons and a resume preview", async () => {
    const scores: Record<string, number> = { "posting-1": 80, "posting-2": 95 };
    const brain = makeScriptedBrain((id) => ({
      eligibility: scores[id] ?? 0,
      desirability: scores[id] ?? 0,
    }));
    current = makeTestApplication([makeNumberedPosting(1), makeNumberedPosting(2)], { brain });
    await runDiscoveryPass(current.application);
    const cards = await createDigestProvider(current.application)();
    expect(cards.map((card) => card.job.id)).toEqual(["posting-2", "posting-1"]);
    expect(cards[0]?.shortlistScore).toBe(95);
    expect(cards[0]?.reasons).toEqual(["First reason.", "Second reason.", "Third reason."]);
    expect(cards[0]?.resumePreview).toContain("Alex Rivera");
    expect(cards[0]?.answers).toEqual([]);
    expect(cards[0]?.fitRating).toBeUndefined();
  });

  it("lists the job's keywords the profile does not support as not added, and never puts them in the preview body", async () => {
    const brain = makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 }));
    current = makeTestApplication([makeNumberedPosting(1, { skills: ["Node.js", "Kubernetes"] })], {
      brain,
    });
    await runDiscoveryPass(current.application);
    const [card] = await createDigestProvider(current.application)();
    const [body, notAdded] = (card?.resumePreview ?? "").split(
      "\n\nNot in your profile, so not added: ",
    );
    expect(notAdded).toMatch(/kubernetes/i);
    expect(body).not.toMatch(/kubernetes/i);
  });

  it("falls back to the keyword score and the stored reason when the profile changed since scoring", async () => {
    const brain = makeScriptedBrain(() => ({ eligibility: 90, desirability: 90 }));
    current = makeTestApplication([makeNumberedPosting(1)], { brain });
    const { application } = current;
    await runDiscoveryPass(application);
    const profile = application.profileStore.load();
    application.profileStore.save({
      ...profile,
      summary: { ...profile.summary, text: `${profile.summary.text} Changed.` },
    });
    const [card] = await createDigestProvider(application)();
    expect(card?.reasons[0]).toMatch(/^Shortlist score/);
    expect(card?.shortlistScore).toBeGreaterThanOrEqual(0);
  });

  it("returns no cards when nothing is shortlisted", async () => {
    current = makeTestApplication([], {});
    expect(await createDigestProvider(current.application)()).toEqual([]);
  });
});

describe("describeResume", () => {
  it("adds no note when every keyword is supported", () => {
    const text = describeResume({
      texSource: "\\begin{document}\\section{Summary} Hello\\end{document}",
      estimatedLines: 1,
      lineLimit: 76.5,
      projectsShown: [],
      projectsLeftOut: [],
      matchedKeywords: [],
      notInProfile: [],
      fileStem: "x",
    });
    expect(text).not.toMatch(/Not in your profile/);
  });
});

describe("createPendingProposals", () => {
  it("shows a proposal with the name of the entry it belongs to", () => {
    current = makeTestApplication([], {});
    current.application.proposalStore.add({
      target: { section: "experience", entryIndex: 0, pointIndex: 1 },
      text: "A proposed wording.",
      keys: ["Node.js"],
      claimCheck: "passed",
    });
    expect(createPendingProposals(current.application)()).toEqual([
      { target: "Harbor Systems, point 2", text: "A proposed wording." },
    ]);
  });

  it("is empty when there is no profile yet", () => {
    current = makeTestApplication([], {}, false);
    expect(createPendingProposals(current.application)()).toEqual([]);
  });
});
