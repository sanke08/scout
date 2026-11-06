import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createResumeBuilder } from "../resume/index.js";
import { profileSchema } from "../shared/index.js";
import { latexToText } from "./latex-to-text.js";

/** The text of a resume built from the fictional sample profile for the given keywords. */
function buildSampleText(keywords: string[]): string {
  const profile = profileSchema.parse(
    JSON.parse(readFileSync("fixtures/profile.sample.json", "utf8")),
  );
  return latexToText(
    createResumeBuilder().build(profile, keywords, { company: "Example" }).texSource,
  );
}

describe("latexToText", () => {
  it("keeps the name, headings and points, and leaves no LaTeX command behind", () => {
    const text = buildSampleText(["Node.js"]);
    expect(text).toContain("Alex Rivera");
    expect(text).toContain("EXPERIENCE");
    expect(text).toMatch(/^ {2}- /m);
    expect(text).not.toMatch(/\\[a-zA-Z]/);
    expect(text).not.toMatch(/[{}]/);
  });

  it("turns escaped characters back into the characters", () => {
    const text = buildSampleText([]);
    expect(text).toContain("Backend & APIs");
    expect(text).not.toContain("\\&");
  });

  it("is deterministic", () => {
    expect(buildSampleText(["Kafka"])).toBe(buildSampleText(["Kafka"]));
  });

  it("gives plain text back for a source without a document body", () => {
    expect(latexToText("\\section{Hello} \\textbf{world}")).toContain("HELLO");
  });
});
