import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATEX_PREAMBLE } from "./preamble.js";

describe("LATEX_PREAMBLE", () => {
  it("equals the template fixture byte for byte", () => {
    const fixture = readFileSync(
      new URL("../../fixtures/resume/preamble.tex", import.meta.url),
      "utf8",
    );
    expect(LATEX_PREAMBLE).toBe(fixture);
  });

  it("ends right after \\begin{document}", () => {
    expect(LATEX_PREAMBLE.endsWith("\\begin{document}\n")).toBe(true);
  });
});
