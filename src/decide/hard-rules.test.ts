import { describe, expect, it } from "vitest";
import { makePosting, makeProfile, makeSettings } from "../../fixtures/decide/builders.js";
import { applyHardRules } from "./hard-rules.js";
import { isInCooldown } from "./cooldown.js";
import { requiredYears } from "./rule-experience.js";

const settings = makeSettings();
const profile = makeProfile();

/** Runs the rules with the sample profile and default settings. */
function verdictFor(changes: Parameters<typeof makePosting>[0], context = {}) {
  return applyHardRules(makePosting(changes), profile, settings, context);
}

describe("the baseline posting", () => {
  it("is kept with no reasons and no notes", () => {
    expect(verdictFor({})).toEqual({ keep: true, reasons: [], notes: [] });
  });
});

describe("location and remote policy", () => {
  it("drops an on-site job outside the accepted places", () => {
    const verdict = verdictFor({ remote: "onsite", location: "Munich, Germany" });
    expect(verdict.keep).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("Munich");
  });

  it("keeps an on-site job in an accepted place, ignoring case", () => {
    expect(verdictFor({ remote: "onsite", location: "BERLIN, Germany" }).keep).toBe(true);
  });

  it("drops a remote job when the profile does not accept remote", () => {
    const strict = makeProfile({ acceptsRemote: false });
    expect(applyHardRules(makePosting({ remote: "remote" }), strict, settings).keep).toBe(false);
  });

  it("keeps a remote job when the profile accepts remote", () => {
    expect(verdictFor({ remote: "remote", location: "Lisbon" }).keep).toBe(true);
  });

  it("keeps a job whose remote kind or location is unknown", () => {
    expect(verdictFor({ remote: "unknown", location: "Munich" }).keep).toBe(true);
    expect(verdictFor({ remote: "onsite", location: "" }).keep).toBe(true);
    expect(verdictFor({ remote: "onsite", location: "Unknown" }).keep).toBe(true);
  });
});

describe("salary floor", () => {
  const floorEuroYear = { currency: "EUR", period: "year" as const };

  it("drops a salary below the floor, converting months to years", () => {
    const verdict = verdictFor({ salary: { max: 3000, ...floorEuroYear, period: "month" } });
    expect(verdict.keep).toBe(false);
  });

  it("keeps a salary at or above the floor, converting months to years", () => {
    expect(verdictFor({ salary: { max: 5000, currency: "EUR", period: "month" } }).keep).toBe(true);
    expect(verdictFor({ salary: { min: 60000, ...floorEuroYear } }).keep).toBe(true);
  });

  it("never drops a posting with no salary", () => {
    expect(verdictFor({ salary: undefined })).toEqual({ keep: true, reasons: [], notes: [] });
    expect(verdictFor({ salary: {} }).keep).toBe(true);
  });

  it("keeps a posting in another currency and says it was not compared", () => {
    const verdict = verdictFor({ salary: { max: 10, currency: "INR", period: "year" } });
    expect(verdict.keep).toBe(true);
    expect(verdict.notes.length).toBe(1);
  });

  it("keeps a posting with no stated period and notes it", () => {
    const verdict = verdictFor({ salary: { max: 10, currency: "EUR" } });
    expect(verdict.keep).toBe(true);
    expect(verdict.notes.length).toBe(1);
  });
});

describe("seniority", () => {
  it("drops a level the user does not accept", () => {
    expect(verdictFor({ seniority: "senior" }).keep).toBe(false);
  });

  it("keeps accepted and unknown levels", () => {
    expect(verdictFor({ seniority: "junior" }).keep).toBe(true);
    expect(verdictFor({ seniority: "unknown" }).keep).toBe(true);
  });
});

describe("years of experience", () => {
  it("parses plus, range, 'to' and singular forms", () => {
    expect(requiredYears("We need 3+ years of experience.")).toBe(3);
    expect(requiredYears("5-7 years experience with Go")).toBe(5);
    expect(requiredYears("Experience: 4 to 6 years")).toBe(4);
    expect(requiredYears("At least 1 year of experience.")).toBe(1);
  });

  it("ignores numbers that are not an experience requirement", () => {
    expect(requiredYears("We are 10 years old and growing.")).toBeUndefined();
    expect(requiredYears("Good communication.")).toBeUndefined();
  });

  it("takes the smallest requirement when several are stated", () => {
    expect(requiredYears("5+ years of experience overall. 2 years of experience with Kafka.")).toBe(
      2,
    );
  });

  it("drops a requirement far above the user's full-time months", () => {
    const verdict = verdictFor({ description: "You bring 5-7 years of experience." });
    expect(verdict.keep).toBe(false);
  });

  it("keeps a requirement within the tolerance of the user's full-time months", () => {
    expect(verdictFor({ description: "3+ years of experience in Node." }).keep).toBe(true);
  });

  it("keeps a posting that states no requirement", () => {
    expect(verdictFor({ description: "Join our team." }).keep).toBe(true);
  });

  it("never counts internship months toward the requirement", () => {
    const description = "You have 5+ years of experience.";
    const noInternship = makeProfile({ experienceMonths: { fullTime: 12, internship: 0 } });
    const longInternship = makeProfile({ experienceMonths: { fullTime: 12, internship: 120 } });
    const first = applyHardRules(makePosting({ description }), noInternship, settings);
    const second = applyHardRules(makePosting({ description }), longInternship, settings);
    expect(first.keep).toBe(false);
    expect(second).toEqual(first);
  });

  it("counts full-time months in full", () => {
    const experienced = makeProfile({ experienceMonths: { fullTime: 60, internship: 0 } });
    const posting = makePosting({ description: "5-7 years of experience." });
    expect(applyHardRules(posting, experienced, settings).keep).toBe(true);
  });
});

describe("excluded companies and industries", () => {
  it("drops an excluded company, ignoring case", () => {
    expect(verdictFor({ company: "EXAMPLE staffing agency" }).keep).toBe(false);
  });

  it("keeps a company whose name only contains an excluded word as part of another word", () => {
    const strict = makeProfile({ excludedCompanies: ["Acme"] });
    expect(applyHardRules(makePosting({ company: "Acmeville" }), strict, settings).keep).toBe(true);
    expect(applyHardRules(makePosting({ company: "ACME Corp" }), strict, settings).keep).toBe(
      false,
    );
  });

  it("drops an excluded industry found in the description, as a whole word", () => {
    expect(verdictFor({ description: "An online Gambling platform." }).keep).toBe(false);
  });

  it("keeps a posting that does not name an excluded industry", () => {
    expect(verdictFor({ description: "We build travel software." }).keep).toBe(true);
  });
});

describe("work authorization", () => {
  it("drops a citizenship or clearance requirement the profile does not match", () => {
    expect(verdictFor({ description: "You must be a U.S. citizen." }).keep).toBe(false);
    expect(verdictFor({ description: "Security clearance required." }).keep).toBe(false);
  });

  it("keeps it when the profile lists a matching authorization", () => {
    const american = makeProfile({ workAuthorization: ["US citizen"] });
    const posting = makePosting({ description: "You must be a US citizen." });
    expect(applyHardRules(posting, american, settings).keep).toBe(true);
  });

  it("keeps a posting with no such phrase", () => {
    expect(verdictFor({ description: "Open to EU residents." }).keep).toBe(true);
  });
});

describe("dealbreakers", () => {
  it("drops a posting containing a dealbreaker phrase, ignoring case and spacing", () => {
    expect(verdictFor({ description: "Expect ON-CALL   every week." }).keep).toBe(false);
  });

  it("keeps a posting without one, and ignores empty dealbreakers", () => {
    const empty = makeProfile({ dealbreakers: [""] });
    expect(applyHardRules(makePosting(), empty, settings).keep).toBe(true);
    expect(verdictFor({ description: "Regular hours." }).keep).toBe(true);
  });
});

describe("cooldown and blacklist", () => {
  const now = new Date("2026-11-07T00:00:00.000Z");
  const applications = [{ company: "Northwind Labs", appliedAt: "2026-10-30T00:00:00.000Z" }];

  it("isInCooldown is true inside the window and false outside it", () => {
    expect(isInCooldown("northwind labs", applications, now, 14)).toBe(true);
    expect(isInCooldown("Northwind Labs", applications, now, 7)).toBe(false);
    expect(isInCooldown("Other Co", applications, now, 14)).toBe(false);
  });

  it("isInCooldown ignores unreadable dates", () => {
    const broken = [{ company: "Northwind Labs", appliedAt: "not a date" }];
    expect(isInCooldown("Northwind Labs", broken, now, 14)).toBe(false);
  });

  it("drops a company in cooldown and keeps it after the window", () => {
    expect(verdictFor({}, { cooldown: { applications, days: 14, now } }).keep).toBe(false);
    expect(verdictFor({}, { cooldown: { applications, days: 3, now } }).keep).toBe(true);
  });

  it("drops a blacklisted company and keeps others", () => {
    expect(verdictFor({}, { blacklist: ["northwind labs"] }).keep).toBe(false);
    expect(verdictFor({}, { blacklist: ["Other Co"] }).keep).toBe(true);
  });
});

describe("flags", () => {
  it("always drops a scam-suspect posting and says why", () => {
    const verdict = verdictFor({ flags: ["scam-suspect"] });
    expect(verdict.keep).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("scam");
  });

  it("keeps a ghost-suspect posting and reports it in notes", () => {
    const verdict = verdictFor({ flags: ["ghost-suspect"] });
    expect(verdict.keep).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.notes.length).toBe(1);
  });
});

describe("collecting reasons", () => {
  it("reports every rule that dropped the posting, not only the first", () => {
    const verdict = verdictFor({
      seniority: "senior",
      remote: "onsite",
      location: "Paris, France",
      company: "Example Staffing Agency",
      flags: ["scam-suspect"],
      description: "Unpaid trial work. 8+ years of experience. Gambling.",
      salary: { max: 1000, currency: "EUR", period: "month" },
    });
    expect(verdict.keep).toBe(false);
    expect(verdict.reasons.length).toBe(8);
    expect(new Set(verdict.reasons).size).toBe(verdict.reasons.length);
  });
});
