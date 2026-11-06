import { describe, expect, it } from "vitest";
import { JOB_STATUSES, ScoutError } from "../shared/index.js";
import {
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
  allowedNextStatuses,
  assertTransitionAllowed,
} from "./transitions.js";

describe("the transition table", () => {
  it("has a row for every status and only lists known statuses", () => {
    for (const status of JOB_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
      for (const next of ALLOWED_TRANSITIONS[status]) {
        expect(JOB_STATUSES).toContain(next);
        expect(next).not.toBe(status);
      }
    }
  });

  it("reaches applied only from submitting", () => {
    for (const status of JOB_STATUSES) {
      const canReachApplied = allowedNextStatuses(status, "approved").includes("applied");
      expect(canReachApplied).toBe(status === "submitting");
    }
  });

  it("leaves submitting only through applied, unverified, needs-you or failed", () => {
    expect([...allowedNextStatuses("submitting", undefined)].sort()).toEqual(
      ["applied", "failed", "needs-you", "unverified"].sort(),
    );
  });

  it("never lets a status other than needs-you leave submitting back to approved", () => {
    expect(allowedNextStatuses("submitting", "approved")).not.toContain("approved");
    expect(allowedNextStatuses("unverified", "approved")).not.toContain("approved");
  });

  it("lets every non-final status except submitting go to skipped and closed", () => {
    for (const status of JOB_STATUSES) {
      if (TERMINAL_STATUSES.includes(status) || status === "submitting") {
        continue;
      }
      const next = allowedNextStatuses(status, undefined);
      if (status !== "skipped") {
        expect(next).toContain("skipped");
      }
      expect(next).toContain("closed");
    }
  });

  it("gives terminal statuses no way out", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(allowedNextStatuses(status, undefined)).toEqual([]);
    }
  });

  it("lets needs-you return to where it came from, and only there", () => {
    expect(allowedNextStatuses("needs-you", "resume-ready")).toContain("resume-ready");
    expect(allowedNextStatuses("needs-you", "resume-ready")).not.toContain("approved");
    expect(allowedNextStatuses("needs-you", "submitting")).toContain("submitting");
  });
});

describe("assertTransitionAllowed", () => {
  it("throws illegal-transition naming both statuses and the allowed ones", () => {
    try {
      assertTransitionAllowed("found", "applied", undefined);
      expect.unreachable("the move should have been refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ScoutError);
      const scoutError = error as ScoutError;
      expect(scoutError.code).toBe("illegal-transition");
      expect(scoutError.message).toContain("found");
      expect(scoutError.message).toContain("applied");
      expect(scoutError.message).toContain("shortlisted");
    }
  });

  it("says a final status has no next statuses", () => {
    expect(() => assertTransitionAllowed("rejected", "found", undefined)).toThrow(/final/);
  });

  it("accepts every move in the table", () => {
    for (const status of JOB_STATUSES) {
      for (const next of ALLOWED_TRANSITIONS[status]) {
        expect(() => assertTransitionAllowed(status, next, undefined)).not.toThrow();
      }
    }
  });
});
