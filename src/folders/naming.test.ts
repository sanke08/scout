import { describe, expect, it } from "vitest";
import { camelCaseCompany, letterSuffix, makeFolderName, roleSlug } from "./naming.js";

describe("folder naming", () => {
  it("writes the company in CamelCase with no punctuation", () => {
    expect(camelCaseCompany("acme, inc.")).toBe("AcmeInc");
    expect(camelCaseCompany("ExampleCorp")).toBe("ExampleCorp");
    expect(camelCaseCompany("O'Brien & Sons / Café")).toBe("OBrienSonsCafe");
  });

  it("uses Unknown when the company has no usable letters", () => {
    for (const company of ["", "   ", "!!!", "日本"]) {
      expect(camelCaseCompany(company)).toBe("Unknown");
    }
  });

  it("makes a short role slug without brackets or punctuation", () => {
    expect(roleSlug("Senior Backend Engineer (Remote)")).toBe("Senior-Backend-Engineer");
    expect(roleSlug("Staff Software Engineer, Platform Infrastructure Team")).toBe(
      "Staff-Software-Engineer-Platform",
    );
    expect(roleSlug("")).toBe("Unknown");
  });

  it("never lets a name contain a path separator or dot", () => {
    const name = makeFolderName(new Date("2026-11-07T10:00:00Z"), "../../etc/passwd", "a/b\\c..d");
    expect(name).toMatch(/^2026-11-07_[A-Za-z0-9]+_[A-Za-z0-9-]+$/);
  });

  it("starts with the creation date, then company, then role", () => {
    expect(makeFolderName(new Date("2026-11-07T23:59:00Z"), "Acme", "Backend Engineer")).toBe(
      "2026-11-07_Acme_Backend-Engineer",
    );
  });

  it("counts endings A to Z, then AA", () => {
    expect([0, 1, 25, 26, 27].map(letterSuffix)).toEqual(["A", "B", "Z", "AA", "AB"]);
  });
});
