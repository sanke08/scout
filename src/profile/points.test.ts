import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  profileSchema,
  ScoutError,
  type Point,
  type PointStatus,
  type Profile,
} from "../shared/index.js";
import {
  addPoint,
  addVariant,
  removePoint,
  removeVariant,
  setPointStatus,
  termsOfProfile,
  updatePoint,
  usablePoints,
  variantUsesOnlyAllowedTerms,
  type PointAddress,
} from "./points.js";

/** The fictional sample profile every test starts from. */
function sampleProfile(): Profile {
  const text = readFileSync(new URL("../../fixtures/profile.sample.json", import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(text));
}

/** Builds a point with the given status and terms. */
function makePoint(status: PointStatus, allowed: string[] = ["Go"]): Point {
  return { text: `A ${status} point.`, allowed, variants: [], status };
}

/** Runs `action` and returns the ScoutError it throws; fails the test if nothing is thrown. */
function thrownBy(action: () => unknown): ScoutError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ScoutError);
    return error as ScoutError;
  }
  throw new Error("Expected the action to throw a ScoutError, but it did not throw.");
}

const firstJobPoint: PointAddress = { section: "experience", entryIndex: 0, pointIndex: 0 };
const firstProjectPoint: PointAddress = { section: "projects", entryIndex: 0, pointIndex: 0 };

describe("usablePoints", () => {
  it("never returns held, excluded or ask-first points", () => {
    const statuses: PointStatus[] = ["confirmed", "from code", "ask first", "hold", "excluded"];
    const usable = usablePoints(statuses.map((status) => makePoint(status)));
    expect(usable.map((point) => point.status)).toEqual(["confirmed", "from code"]);
    for (const point of usable) {
      expect(["hold", "excluded", "ask first"]).not.toContain(point.status);
    }
  });

  it("returns nothing for an empty list", () => {
    expect(usablePoints([])).toEqual([]);
  });
});

describe("termsOfProfile", () => {
  it("returns lower-case terms without duplicates from skills and every point", () => {
    const terms = termsOfProfile(sampleProfile());
    expect(terms).toContain("typescript");
    expect(terms).toContain("dead-letter queue");
    expect(terms).toContain("redis");
    expect(new Set(terms).size).toBe(terms.length);
    for (const term of terms) {
      expect(term).toBe(term.trim().toLowerCase());
      expect(term).not.toBe("");
    }
  });

  it("counts a term spelled two ways once", () => {
    const profile = addPoint(
      sampleProfile(),
      { section: "projects", entryIndex: 0 },
      makePoint("hold", [" KAFKA ", "kafka"]),
    );
    expect(termsOfProfile(profile).filter((term) => term === "kafka")).toHaveLength(1);
  });
});

describe("variantUsesOnlyAllowedTerms", () => {
  const point = makePoint("confirmed", ["React", "Node.js"]);

  it("accepts keys inside the allowed list, ignoring case", () => {
    expect(variantUsesOnlyAllowedTerms(point, { text: "x", keys: ["react", "NODE.JS"] })).toBe(
      true,
    );
    expect(variantUsesOnlyAllowedTerms(point, { text: "x", keys: [] })).toBe(true);
  });

  it("rejects a key outside the allowed list", () => {
    expect(variantUsesOnlyAllowedTerms(point, { text: "x", keys: ["React", "Kafka"] })).toBe(false);
  });
});

describe("point edits", () => {
  it("never change their input", () => {
    const profile = sampleProfile();
    const snapshot = structuredClone(profile);
    addPoint(profile, { section: "experience", entryIndex: 0 }, makePoint("hold"));
    removePoint(profile, firstJobPoint);
    setPointStatus(profile, firstJobPoint, "hold");
    addVariant(profile, firstJobPoint, { text: "x", keys: ["React"] });
    expect(profile).toEqual(snapshot);
  });

  it("addPoint appends to a job or a project and leaves others alone", () => {
    const profile = sampleProfile();
    const withJobPoint = addPoint(
      profile,
      { section: "experience", entryIndex: 1 },
      makePoint("hold"),
    );
    expect(withJobPoint.experience[1]?.points).toHaveLength(
      (profile.experience[1]?.points.length ?? 0) + 1,
    );
    expect(withJobPoint.experience[0]).toEqual(profile.experience[0]);
    const withProjectPoint = addPoint(
      profile,
      { section: "projects", entryIndex: 2 },
      makePoint("hold"),
    );
    expect(withProjectPoint.projects[2]?.points.at(-1)?.status).toBe("hold");
    expect(withProjectPoint.experience).toEqual(profile.experience);
  });

  it("updatePoint replaces exactly one point", () => {
    const profile = sampleProfile();
    const replacement = { ...makePoint("confirmed", ["Go"]), text: "Rewritten." };
    const updated = updatePoint(profile, firstProjectPoint, replacement);
    expect(updated.projects[0]?.points[0]).toEqual(replacement);
    expect(updated.projects[0]?.points[1]).toEqual(profile.projects[0]?.points[1]);
  });

  it("removePoint removes exactly one point", () => {
    const profile = sampleProfile();
    const removed = removePoint(profile, firstProjectPoint);
    expect(removed.projects[0]?.points).toEqual(profile.projects[0]?.points.slice(1));
  });

  it("setPointStatus changes only the status", () => {
    const profile = sampleProfile();
    const held = setPointStatus(profile, firstJobPoint, "hold");
    expect(held.experience[0]?.points[0]).toEqual({
      ...profile.experience[0]?.points[0],
      status: "hold",
    });
    expect(usablePoints(held.experience[0]?.points ?? [])).toHaveLength(3);
  });

  it("refuses an address that does not exist with a full sentence", () => {
    const profile = sampleProfile();
    const addresses: PointAddress[] = [
      { section: "experience", entryIndex: 9, pointIndex: 0 },
      { section: "projects", entryIndex: 0, pointIndex: 99 },
      { section: "projects", entryIndex: -1, pointIndex: 0 },
    ];
    for (const address of addresses) {
      const error = thrownBy(() => removePoint(profile, address));
      expect(error.code).toBe("invalid-input");
      expect(error.message).toMatch(/^There is no .*\.$/);
    }
    expect(
      thrownBy(() => addPoint(profile, { section: "projects", entryIndex: 7 }, makePoint("hold")))
        .code,
    ).toBe("invalid-input");
  });
});

describe("variants", () => {
  it("addVariant adds a wording whose keys are allowed", () => {
    const profile = sampleProfile();
    const updated = addVariant(profile, firstJobPoint, {
      text: "Built the booking flow with React.",
      keys: ["React"],
    });
    const variants = updated.experience[0]?.points[0]?.variants ?? [];
    expect(variants).toHaveLength((profile.experience[0]?.points[0]?.variants.length ?? 0) + 1);
    expect(variants.at(-1)?.keys).toEqual(["React"]);
  });

  it("addVariant refuses a term outside allowed and changes nothing", () => {
    const profile = sampleProfile();
    const error = thrownBy(() =>
      addVariant(profile, firstJobPoint, { text: "Used Kafka.", keys: ["Kafka"] }),
    );
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("Kafka");
    expect(profile.experience[0]?.points[0]?.variants).toHaveLength(1);
  });

  it("updatePoint and addPoint refuse a variant that uses a term outside allowed", () => {
    const profile = sampleProfile();
    const bad: Point = {
      ...makePoint("confirmed", ["Go"]),
      variants: [{ text: "Used Kafka.", keys: ["Kafka"] }],
    };
    expect(thrownBy(() => updatePoint(profile, firstJobPoint, bad)).code).toBe("invalid-input");
    expect(
      thrownBy(() => addPoint(profile, { section: "experience", entryIndex: 0 }, bad)).code,
    ).toBe("invalid-input");
  });

  it("updatePoint refuses removing a term a variant still needs", () => {
    const profile = sampleProfile();
    const point = profile.experience[0]?.points[0];
    expect(point?.variants[0]?.keys).toContain("Node.js");
    const withoutNode = { ...point!, allowed: ["React"] };
    expect(thrownBy(() => updatePoint(profile, firstJobPoint, withoutNode)).code).toBe(
      "invalid-input",
    );
  });

  it("removeVariant removes exactly one wording and refuses a missing position", () => {
    const profile = sampleProfile();
    const withTwo = addVariant(profile, firstJobPoint, { text: "Second.", keys: ["React"] });
    const removed = removeVariant(withTwo, firstJobPoint, 0);
    expect(removed.experience[0]?.points[0]?.variants.map((variant) => variant.text)).toEqual([
      "Second.",
    ]);
    expect(thrownBy(() => removeVariant(withTwo, firstJobPoint, 5)).code).toBe("invalid-input");
  });
});
