import { describe, expect, it } from "vitest";
import { normalizeKeywords, containsWholeWord } from "./keywords.js";
import { chooseWording } from "./wording.js";

const point = {
  text: "Cut load time by splitting the app.",
  allowed: ["performance", "Redis"],
  variants: [
    { text: "Cut load time with code splitting.", keys: ["code splitting"] },
    { text: "Cut load time with code splitting and Redis.", keys: ["code splitting", "Redis"] },
  ],
};

describe("normalizeKeywords", () => {
  it("lower-cases, trims, drops empties and de-duplicates in order", () => {
    expect(normalizeKeywords([" Node.js", "node.js", "", "  ", "Kafka"])).toEqual([
      "node.js",
      "kafka",
    ]);
  });
});

describe("containsWholeWord", () => {
  it("matches whole words only", () => {
    expect(containsWholeWord("Google Cloud", "go")).toBe(false);
    expect(containsWholeWord("Written in Go.", "go")).toBe(true);
    expect(containsWholeWord("Built with Node.js, fast.", "node.js")).toBe(true);
  });

  it("treats regular expression characters in a keyword as plain text", () => {
    expect(containsWholeWord("Uses C++ daily", "c++")).toBe(true);
    expect(containsWholeWord("Uses C daily", "c++")).toBe(false);
  });
});

describe("chooseWording", () => {
  it("uses the base text when no keywords are given", () => {
    const chosen = chooseWording(point, []);
    expect(chosen.text).toBe(point.text);
    expect(chosen.usedVariant).toBe(false);
  });

  it("uses the alternate whose keys match the most keywords", () => {
    const chosen = chooseWording(point, ["code splitting", "redis"]);
    expect(chosen.text).toBe("Cut load time with code splitting and Redis.");
    expect(chosen.usedVariant).toBe(true);
  });

  it("prefers the earlier alternate on a tie", () => {
    const chosen = chooseWording(point, ["code splitting"]);
    expect(chosen.text).toBe("Cut load time with code splitting.");
  });

  it("keeps the base text when only unrelated keywords are given", () => {
    expect(chooseWording(point, ["kubernetes"]).text).toBe(point.text);
  });

  it("counts a keyword as supported by allowed terms or by a whole word of the chosen text", () => {
    const chosen = chooseWording(point, ["performance", "code splitting", "kubernetes"]);
    expect(chosen.matchedKeywords).toEqual(["performance", "code splitting"]);
  });
});
