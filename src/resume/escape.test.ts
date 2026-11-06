import { describe, expect, it } from "vitest";
import { escapeHref, escapeLatex, linkDisplay, linkTarget } from "./escape.js";

describe("escapeLatex", () => {
  it("escapes every special character exactly once", () => {
    const escaped = escapeLatex("& % $ # _ { } ~ ^ \\");
    expect(escaped).toBe(
      "\\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
    );
  });

  it("leaves no raw special character outside of the escape sequences", () => {
    const escaped = escapeLatex("a&b%c$d#e_f{g}h~i^j\\k");
    const withoutEscapes = escaped
      .replace(/\\textbackslash\{\}|\\textasciitilde\{\}|\\textasciicircum\{\}/g, "")
      .replace(/\\[&%$#_{}]/g, "");
    expect(withoutEscapes).toBe("abcdefghijk");
  });

  it("turns dashes into LaTeX dashes and curly quotes into straight quotes", () => {
    expect(escapeLatex("a \u2013 b \u2014 c")).toBe("a -- b --- c");
    expect(escapeLatex("\u2018one\u2019 \u201Ctwo\u201D")).toBe("'one' \"two\"");
  });

  it("gives an empty string for a missing value", () => {
    expect(escapeLatex(undefined)).toBe("");
  });
});

describe("links", () => {
  it("escapes percent and hash in an href", () => {
    expect(escapeHref("https://example.com/a%20b#c")).toBe("https://example.com/a\\%20b\\#c");
  });

  it("adds https only when the address has no protocol", () => {
    expect(linkTarget("github.com/example-alex")).toBe("https://github.com/example-alex");
    expect(linkTarget("http://example.com")).toBe("http://example.com");
  });

  it("strips the protocol and www from the displayed text", () => {
    expect(linkDisplay("https://www.linkedin.com/in/example-alex")).toBe(
      "linkedin.com/in/example-alex",
    );
    expect(linkDisplay("github.com/example-alex")).toBe("github.com/example-alex");
  });
});
