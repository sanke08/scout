import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createResumeBuilder } from "../../resume/index.js";
import { profileSchema } from "../../shared/index.js";
import { resumePointsFromTex } from "./notes-resume-points.js";

/** The resume the builder makes from the fictional sample profile. */
function sampleResume(): string {
  const profile = profileSchema.parse(
    JSON.parse(readFileSync("fixtures/profile.sample.json", "utf8")),
  );
  return createResumeBuilder().build(profile, ["Node.js"], { company: "Example" }).texSource;
}

describe("resumePointsFromTex", () => {
  it("reads only experience and project points, each under the employer or project name", () => {
    const points = resumePointsFromTex(sampleResume());
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(["experience", "projects"]).toContain(point.section);
      expect(point.heading).not.toBe("");
      expect(point.heading).not.toContain("|");
      expect(point.text).not.toMatch(/\\[a-zA-Z]|[{}]/);
    }
    expect(points.some((point) => point.heading === "Harbor Systems")).toBe(true);
    expect(points.some((point) => point.section === "projects")).toBe(true);
  });

  it("never turns the summary, skills or education into points", () => {
    const text = resumePointsFromTex(sampleResume())
      .map((point) => point.text)
      .join("\n");
    expect(text).not.toContain("Languages:");
    expect(text).not.toContain("Bachelor of Science");
  });

  it("gives an empty list for text that is not a resume", () => {
    expect(resumePointsFromTex("just some words")).toEqual([]);
  });
});
