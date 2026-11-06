import { describe, expect, it } from "vitest";
import { checkClaims, claimRetryInstructions, extractClaims } from "./claims.js";

const support = {
  allowedTerms: ["Kafka", "Go", "mentoring"],
  knownFacts: [
    "Mentored two juniors",
    "Cut message delay by 40 percent in 2024",
    "Team of 5 engineers",
  ],
};

function claimTexts(text: string): string[] {
  return extractClaims(text).map((claim) => `${claim.kind}:${claim.text}`);
}

describe("extractClaims", () => {
  it("finds terms, figures, team sizes, roles and years", () => {
    const claims = claimTexts(
      "Led a team of eight on Kafka, cutting delay by 40% in 2024 for 17,000 users",
    );
    expect(claims).toEqual([
      "role:Led",
      "team-size:team of eight",
      "term:Kafka",
      "number:40%",
      "year:2024",
      "number:17,000 users",
    ]);
  });

  it("does not treat the first word of a sentence or ordinary words as claims", () => {
    expect(extractClaims("Built a small tool. Wrote tests for it.")).toEqual([]);
  });

  it("recognises technology names in lower case and mixed case", () => {
    expect(claimTexts("built a kubernetes operator with gRPC and Node.js")).toEqual([
      "term:kubernetes",
      "term:gRPC",
      "term:Node.js",
    ]);
  });

  it("does not report the same claim twice or a figure inside a team size", () => {
    expect(claimTexts("A team of 8 engineers; a team of 8 engineers")).toEqual([
      "team-size:team of 8",
    ]);
  });

  it("understands the 'N-person team' form", () => {
    expect(claimTexts("Worked in an 8-person team")).toEqual(["team-size:8-person team"]);
  });
});

describe("checkClaims", () => {
  it("blocks 'led a team of eight' when the profile says 'mentored two juniors'", () => {
    const result = checkClaims("Led a team of eight engineers", support);
    const blocked = result.unsupported.map((claim) => claim.text);
    expect(blocked).toContain("Led");
    expect(blocked).toContain("team of eight");
    expect(result.unsupported.every((claim) => claim.reason.length > 0)).toBe(true);
  });

  it("passes wording that only uses backed claims", () => {
    const result = checkClaims(
      "Mentored two juniors and cut delay by 40% in 2024 with Kafka",
      support,
    );
    expect(result.unsupported).toEqual([]);
    expect(result.supported.length).toBeGreaterThan(0);
  });

  it("matches figures however they are written", () => {
    expect(checkClaims("Cut delay by 40 percent", support).unsupported).toEqual([]);
    expect(
      checkClaims("Part of an 5-person team", support).unsupported.map((c) => c.kind),
    ).not.toContain("team-size");
    expect(checkClaims("Mentored 2 juniors", support).unsupported).toEqual([]);
  });

  it("blocks a figure, a year and a technology the profile lacks", () => {
    const result = checkClaims("Cut delay by 80% in 2021 using Redis", support);
    expect(result.unsupported.map((claim) => claim.text).sort()).toEqual(["2021", "80%", "Redis"]);
  });

  it("blocks a role word that the profile does not hold, and allows one it does", () => {
    expect(checkClaims("Senior engineer", support).unsupported.map((claim) => claim.text)).toEqual([
      "Senior",
    ]);
    const withRole = { ...support, knownFacts: ["Led the migration"] };
    expect(checkClaims("Leading migrations", withRole).unsupported).toEqual([]);
  });

  it("does not let a claim hide inside a longer word or number", () => {
    const result = checkClaims("Cut delay by 140%", support);
    expect(result.unsupported.map((claim) => claim.text)).toEqual(["140%"]);
  });

  it("gives the same answer every time for the same input", () => {
    const first = checkClaims("Led a team of eight on Redis in 2019", support);
    expect(checkClaims("Led a team of eight on Redis in 2019", support)).toEqual(first);
  });
});

describe("claimRetryInstructions", () => {
  it("names each unsupported claim and tells the model not to add new ones", () => {
    const { unsupported } = checkClaims("Led a team of eight", support);
    const text = claimRetryInstructions(unsupported);
    expect(text).toContain('"team of eight"');
    expect(text).toContain('"Led"');
    expect(text).toMatch(/Do not add/);
  });

  it("quotes at most ten claims", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      kind: "number" as const,
      text: `${index + 100} users`,
      reason: "x",
    }));
    expect(claimRetryInstructions(many).match(/users/g)).toHaveLength(10);
  });
});
