import { describe, expect, it } from "vitest";
import { estimateLines, LINE_LIMIT } from "./estimate.js";
import type { ResumeModel } from "./model.js";

const baseModel: ResumeModel = {
  identity: { name: "Alex Rivera", location: "Berlin" },
  education: { degree: "BSc", dates: "2019", school: "Example University" },
  summary: "Short summary.",
  skills: [{ label: "Languages", items: ["Go"] }],
  experience: [{ title: "Engineer", org: "Org", dates: "2023", place: "Berlin", points: ["One."] }],
  projects: [],
};

describe("estimateLines", () => {
  it("has the calibrated limit", () => {
    expect(LINE_LIMIT).toBe(76.5);
  });

  it("is deterministic and rounded to one decimal", () => {
    const first = estimateLines(baseModel);
    expect(estimateLines(baseModel)).toBe(first);
    expect(Math.round(first * 10) / 10).toBe(first);
  });

  it("grows when a bullet or a project is added", () => {
    const base = estimateLines(baseModel);
    const withProject = estimateLines({
      ...baseModel,
      projects: [{ title: "P", stack: "Go", points: ["A bullet."] }],
    });
    expect(withProject).toBeGreaterThan(base);
  });

  it("counts a long bullet as more than one line", () => {
    const short = estimateLines(baseModel);
    const long = estimateLines({
      ...baseModel,
      experience: [{ ...baseModel.experience[0]!, points: ["x".repeat(130)] }],
    });
    expect(long - short).toBe(1);
  });
});
