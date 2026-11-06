import { describe, expect, it } from "vitest";
import { makePosting, makeProfile } from "../../fixtures/decide/builders.js";
import { keywordScore } from "./keyword-score.js";
import { rankPostings } from "./rank-postings.js";
import { termsOfProfile } from "./profile-terms.js";

const profile = makeProfile();

describe("termsOfProfile", () => {
  it("is lower-case, has no duplicates and covers skills rows and allowed lists", () => {
    const terms = termsOfProfile(profile);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms).toContain("node.js");
    expect(terms).toContain("javascript");
    expect(terms).toContain("code splitting");
    expect(terms.every((term) => term === term.toLowerCase())).toBe(true);
  });

  it("leaves out terms from points the user cannot use, and never-used items", () => {
    const changed = structuredClone(profile);
    const point = changed.projects[0]?.points[0];
    if (point === undefined) throw new Error("sample profile has no project point");
    point.allowed = ["Haskell"];
    point.status = "hold";
    changed.neverUsed = ["Redis"];
    const terms = termsOfProfile(changed);
    expect(terms).not.toContain("haskell");
    expect(terms).not.toContain("redis");
  });
});

describe("keywordScore", () => {
  it("is a whole number from 0 to 100", () => {
    const score = keywordScore(makePosting(), profile);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("is deterministic", () => {
    const posting = makePosting();
    expect(keywordScore(posting, profile)).toBe(keywordScore(posting, profile));
  });

  it("is high for a full skill match and zero for no overlap", () => {
    const match = makePosting({ skills: ["Node.js", "TypeScript"] });
    const none = makePosting({
      skills: ["COBOL", "Fortran"],
      title: "Mainframe operator",
      description: "Operate mainframes.",
    });
    expect(keywordScore(match, profile)).toBeGreaterThanOrEqual(70);
    expect(keywordScore(none, profile)).toBe(0);
  });

  it("weighs skills the posting names above words in its description", () => {
    const named = makePosting({ skills: ["Kafka"], description: "Work with us." });
    const mentioned = makePosting({
      skills: ["COBOL"],
      description: "We use Kafka sometimes.",
      title: "Engineer",
    });
    expect(keywordScore(named, profile)).toBeGreaterThan(keywordScore(mentioned, profile));
  });

  it("lowers the score for missing skills without any other penalty", () => {
    const all = makePosting({ skills: ["Node.js", "Kafka"] });
    const half = makePosting({ skills: ["Node.js", "COBOL"] });
    expect(keywordScore(half, profile)).toBeLessThan(keywordScore(all, profile));
    expect(keywordScore(half, profile)).toBeGreaterThan(0);
  });

  it("scores from the description alone when no skills are named", () => {
    const posting = makePosting({
      skills: [],
      description: "TypeScript, React, Node.js, PostgreSQL and Redis every day.",
    });
    expect(keywordScore(posting, profile)).toBe(100);
  });

  it("matches whole words only, and short terms only in named skills", () => {
    const text = makePosting({
      skills: [],
      title: "Engineer",
      description: "Let us go to market. Gopher culture.",
    });
    expect(keywordScore(text, profile)).toBe(0);
    expect(keywordScore(makePosting({ skills: ["Go"] }), profile)).toBeGreaterThan(0);
  });

  it("does not credit a skill the profile does not hold, whatever the description says", () => {
    const posting = makePosting({ skills: ["Haskell"], description: "Haskell Haskell Haskell." });
    expect(keywordScore(posting, profile)).toBe(0);
  });
});

describe("rankPostings", () => {
  const strong = makePosting({ id: "strong", skills: ["Node.js", "TypeScript"] });
  const weak = makePosting({ id: "weak", skills: ["COBOL"] });
  const tieA = makePosting({ id: "tie-a", skills: ["COBOL"] });

  it("sorts best first and returns scores", () => {
    const ranked = rankPostings([weak, strong], profile);
    expect(ranked.map((entry) => entry.posting.id)).toEqual(["strong", "weak"]);
    expect(ranked[0]?.score).toBe(keywordScore(strong, profile));
  });

  it("is deterministic and keeps input order for equal scores", () => {
    const first = rankPostings([weak, tieA, strong], profile);
    const second = rankPostings([weak, tieA, strong], profile);
    expect(second).toEqual(first);
    expect(first.map((entry) => entry.posting.id)).toEqual(["strong", "weak", "tie-a"]);
  });

  it("does not change the input list", () => {
    const input = [weak, strong];
    rankPostings(input, profile);
    expect(input.map((posting) => posting.id)).toEqual(["weak", "strong"]);
  });
});
