import { describe, expect, it } from "vitest";
import {
  cleanValue,
  parseFrontMatter,
  patchFrontMatter,
  renderFrontMatter,
} from "./front-matter.js";

describe("front matter", () => {
  it("round-trips rendered fields", () => {
    const fields = {
      status: "found",
      company: "Acme: the best",
      link: "https://example.com/a?b=c",
    };
    expect(parseFrontMatter(`${renderFrontMatter(fields)}\n\nBody`)?.fields).toEqual(fields);
  });

  it("is tolerant of case, spacing, CRLF, blank lines and lines without a colon", () => {
    const text = "﻿\r\n---\r\nStatus : Applied\r\nResume Sent: x.pdf\r\njust a note\r\n---\r\nBody";
    const parsed = parseFrontMatter(text);
    expect(parsed?.fields).toEqual({ status: "Applied", resume_sent: "x.pdf" });
    expect(parsed?.body).toBe("Body");
  });

  it("returns undefined when there is no complete block", () => {
    expect(parseFrontMatter("# Just a heading\n")).toBeUndefined();
    expect(parseFrontMatter("---\nstatus: found\nno closing fence")).toBeUndefined();
  });

  it("changes only the named fields and keeps other lines and the body untouched", () => {
    const text = "---\nstatus: found\n# a hand comment: kept\ncompany: Acme\n---\n\n---\nBody\n";
    const patched = patchFrontMatter(text, { status: "applied", applied: "2026-11-07" });
    expect(patched).toBe(
      "---\nstatus: applied\n# a hand comment: kept\ncompany: Acme\napplied: 2026-11-07\n---\n\n---\nBody\n",
    );
  });

  it("keeps every value on one line and writes unknown for empty values", () => {
    expect(cleanValue("a\nb\r\nc")).toBe("a b c");
    expect(cleanValue("   ")).toBe("unknown");
    const patched = patchFrontMatter("---\nstatus: found\n---\n", { company: "x\ninjected: yes" });
    expect(parseFrontMatter(patched)?.fields["injected"]).toBeUndefined();
  });

  it("refuses to patch text with no block", () => {
    expect(() => patchFrontMatter("no block", { status: "found" })).toThrow(/front-matter/);
  });
});
