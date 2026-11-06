import { describe, expect, it } from "vitest";
import { makeJobRecord, makeProfile, makeSettings } from "../../fixtures/mail/builders.js";
import {
  CONNECTION_NOTE_LIMIT,
  daysWithoutReply,
  draftFollowUp,
  isFollowUpDue,
} from "./follow-up.js";

/** Applied on 2026-11-01 (the builder default). */
const appliedJob = makeJobRecord({ title: "Backend Engineer", company: "Northwind Labs" });
const settings = makeSettings({ followUpAfterDays: 7 });
const profile = makeProfile();

/** A date `days` days after the job was applied. */
function daysAfterApplying(days: number): Date {
  return new Date(Date.parse("2026-11-01T00:00:00.000Z") + days * 24 * 60 * 60 * 1000);
}

describe("follow-up timing", () => {
  it("is not due before the limit", () => {
    expect(draftFollowUp(appliedJob, profile, settings, daysAfterApplying(6))).toBeUndefined();
    expect(isFollowUpDue(appliedJob, settings, daysAfterApplying(6))).toBe(false);
  });

  it("is due exactly at the limit and after it", () => {
    expect(draftFollowUp(appliedJob, profile, settings, daysAfterApplying(7))).toBeDefined();
    expect(draftFollowUp(appliedJob, profile, settings, daysAfterApplying(30))).toBeDefined();
  });

  it("follows the setting: a limit of 3 days makes day 4 due", () => {
    const short = makeSettings({ followUpAfterDays: 3 });
    expect(isFollowUpDue(appliedJob, short, daysAfterApplying(4))).toBe(true);
  });

  it("is never due for a job that got a reply or is not applied", () => {
    for (const status of [
      "contacted",
      "interviewing",
      "offer",
      "rejected",
      "found",
      "unverified",
    ] as const) {
      const job = makeJobRecord({ status });
      expect(draftFollowUp(job, profile, settings, daysAfterApplying(100))).toBeUndefined();
      expect(daysWithoutReply(job, daysAfterApplying(100))).toBeUndefined();
    }
  });

  it("uses the exact apply time when given, so seeing the posting again does not restart the clock", () => {
    const seenAgain = makeJobRecord({ updatedAt: "2026-11-09T00:00:00.000Z" });
    const now = daysAfterApplying(9);
    expect(isFollowUpDue(seenAgain, settings, now)).toBe(false);
    expect(isFollowUpDue(seenAgain, settings, now, "2026-11-01T00:00:00.000Z")).toBe(true);
  });

  it("counts whole days and never goes below zero", () => {
    expect(daysWithoutReply(appliedJob, daysAfterApplying(9.9))).toBe(9);
    expect(daysWithoutReply(appliedJob, daysAfterApplying(-2))).toBe(0);
  });
});

describe("follow-up draft content", () => {
  const draft = draftFollowUp(appliedJob, profile, settings, daysAfterApplying(9));

  it("is a draft: never marked sent", () => {
    expect(draft?.sent).toBe(false);
    expect(draft?.jobId).toBe(appliedJob.id);
  });

  it("is about 150 words", () => {
    const words = (draft?.emailBody ?? "").split(/\s+/).filter((word) => word !== "");
    expect(words.length).toBeGreaterThanOrEqual(70);
    expect(words.length).toBeLessThanOrEqual(180);
  });

  it("says where the user works and what they build, from the first experience entry", () => {
    const first = profile.experience[0];
    expect(draft?.emailBody).toContain(first?.org);
    expect(draft?.emailBody).toContain(first?.title);
    expect(draft?.emailBody).toContain("where I built the booking flow");
  });

  it("has one project line with exactly one link, availability, resume line and sign-off", () => {
    const body = draft?.emailBody ?? "";
    expect(body.match(/https?:\/\/|github\.com/g) ?? []).toHaveLength(1);
    expect(body).toContain(`notice period is ${profile.preferences.noticePeriodDays} days`);
    expect(body).toContain("resume is attached");
    expect(body.trimEnd().endsWith(profile.identity.name)).toBe(true);
  });

  it("has a connection note under 300 characters", () => {
    expect((draft?.connectionNote ?? "").length).toBeLessThan(CONNECTION_NOTE_LIMIT);
    expect(draft?.connectionNote).toContain("Northwind Labs");
  });

  it("keeps the connection note under the limit even for a very long title and company", () => {
    const long = makeJobRecord({
      title: "T".repeat(200) + " Engineer",
      company: "C".repeat(200) + " Labs",
    });
    const result = draftFollowUp(long, profile, settings, daysAfterApplying(9));
    expect((result?.connectionNote ?? "").length).toBeLessThan(CONNECTION_NOTE_LIMIT);
  });

  it("contains no fact outside the profile and the job", () => {
    const allowed = JSON.stringify(profile) + appliedJob.title + appliedJob.company + " 9 ";
    const body = `${draft?.emailBody}\n${draft?.connectionNote}\n${draft?.subject}`;
    for (const number of body.match(/\d+(\.\d+)?/g) ?? []) {
      expect(allowed).toContain(number);
    }
    for (const address of body.match(
      /\b\S+@\S+\b|(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|io|dev)\S*/g,
    ) ?? []) {
      expect(JSON.stringify(profile)).toContain(address.replace(/[.,;:]+$/, ""));
    }
  });

  it("uses no point the profile does not let Scout use", () => {
    const held = structuredClone(profile);
    const first = held.experience[0];
    if (first === undefined) throw new Error("The sample profile has no experience.");
    first.points = first.points.map((point, index) => ({
      ...point,
      status: index === 0 ? "hold" : point.status,
    }));
    const result = draftFollowUp(appliedJob, held, settings, daysAfterApplying(9));
    expect(result?.emailBody).not.toContain(first.points[0]?.text.replace(/\.$/, "").slice(1));
  });

  it("leaves out the notice period and project lines when the profile has none", () => {
    const bare = structuredClone(profile);
    delete bare.preferences.noticePeriodDays;
    bare.projects = [];
    const result = draftFollowUp(appliedJob, bare, settings, daysAfterApplying(9));
    expect(result?.emailBody).not.toMatch(/notice period|personal projects/);
    expect(result?.emailBody).toContain("resume is attached");
  });
});
