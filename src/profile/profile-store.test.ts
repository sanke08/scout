import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileSchema, ScoutError, type Profile } from "../shared/index.js";
import { createProfileStore } from "./profile-store.js";

/** The fictional sample profile every test starts from. */
function sampleProfile(): Profile {
  const text = readFileSync(new URL("../../fixtures/profile.sample.json", import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(text));
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

describe("profile store", () => {
  let folder: string;
  let path: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "scout-profile-"));
    path = join(folder, "data", "profile.json");
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("reports whether a profile file exists", () => {
    const store = createProfileStore(path);
    expect(store.exists()).toBe(false);
    store.save(sampleProfile());
    expect(store.exists()).toBe(true);
  });

  it("round-trips: what is saved is what is loaded", () => {
    const store = createProfileStore(path);
    const saved = store.save(sampleProfile());
    expect(store.load()).toEqual(saved);
    expect(profileSchema.safeParse(store.load()).success).toBe(true);
  });

  it("keeps all content apart from the version when saving", () => {
    const store = createProfileStore(path);
    const original = sampleProfile();
    const saved = store.save(original);
    expect({ ...saved, version: 0 }).toEqual({ ...original, version: 0 });
  });

  it("bumps the version by exactly one when the content changed", () => {
    const store = createProfileStore(path);
    const first = store.save(sampleProfile());
    const second = store.save({ ...first, summary: { ...first.summary, text: "A new summary." } });
    expect(second.version).toBe(first.version + 1);
    expect(store.load().version).toBe(second.version);
  });

  it("does not bump the version or rewrite the file when nothing changed", () => {
    const store = createProfileStore(path);
    const first = store.save(sampleProfile());
    const before = readFileSync(path, "utf8");
    const again = store.save(first);
    expect(again.version).toBe(first.version);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("ignores the version the caller holds and counts from the file", () => {
    const store = createProfileStore(path);
    const first = store.save(sampleProfile());
    const staleVersion = { ...first, version: 0, summary: { ...first.summary, text: "Edited." } };
    expect(store.save(staleVersion).version).toBe(first.version + 1);
  });

  it("treats a hand-edit that only reorders keys as no change", () => {
    const store = createProfileStore(path);
    const first = store.save(sampleProfile());
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    writeFileSync(path, JSON.stringify(reordered, null, 4));
    expect(store.save(first).version).toBe(first.version);
  });

  it("writes plain two-space-indented JSON ending in a newline, without leftovers", () => {
    const store = createProfileStore(path);
    store.save(sampleProfile());
    const text = readFileSync(path, "utf8");
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(readdirSync(join(folder, "data"))).toEqual(["profile.json"]);
  });

  it("throws not-found with a sentence on how to create the profile when there is none", () => {
    const error = thrownBy(() => createProfileStore(path).load());
    expect(error.code).toBe("not-found");
    expect(error.message).toContain(path);
    expect(error.message).toMatch(/first-run setup|profile\.sample\.json/);
    expect(error.message).toMatch(/\.$/);
  });

  it("throws invalid-input naming the field path for invalid content", () => {
    const store = createProfileStore(path);
    store.save(sampleProfile());
    const broken = JSON.parse(readFileSync(path, "utf8"));
    broken.experience[0].points[1].status = "maybe";
    writeFileSync(path, JSON.stringify(broken));
    const error = thrownBy(() => store.load());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("experience[0].points[1].status");
    expect(error.message).toMatch(/^[A-Z].*\.$/);
  });

  it("refuses to save an invalid profile and names the field", () => {
    const store = createProfileStore(path);
    const invalid = { ...sampleProfile(), identity: { name: 5 } } as unknown as Profile;
    const error = thrownBy(() => store.save(invalid));
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("identity");
    expect(store.exists()).toBe(false);
  });

  it("reports malformed JSON as invalid-input and leaves the file as it was", () => {
    const store = createProfileStore(path);
    store.save(sampleProfile());
    writeFileSync(path, '{ "schemaVersion": 1, ');
    const error = thrownBy(() => store.load());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("not valid JSON");
    thrownBy(() => store.save(sampleProfile()));
    expect(readFileSync(path, "utf8")).toBe('{ "schemaVersion": 1, ');
  });

  it("refuses a newer schemaVersion on load and save, leaving the file untouched", () => {
    const store = createProfileStore(path);
    const newer = JSON.stringify({ ...sampleProfile(), schemaVersion: 2, futureField: true });
    mkdirSync(join(folder, "data"));
    writeFileSync(path, newer);
    const loadError = thrownBy(() => store.load());
    expect(loadError.code).toBe("invalid-input");
    expect(loadError.message).toContain("newer Scout");
    const saveError = thrownBy(() => store.save(sampleProfile()));
    expect(saveError.message).toContain("newer Scout");
    expect(readFileSync(path, "utf8")).toBe(newer);
  });
});

describe("saving a variant that uses a term the point does not allow", () => {
  it("is refused, so the Profile page cannot bypass the rule", () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-profile-variant-"));
    try {
      const store = createProfileStore(join(directory, "profile.json"));
      const profile = structuredClone(sampleProfile());
      profile.experience[0]!.points[0]!.variants.push({
        text: "Built the booking flow with Kubernetes.",
        keys: ["Kubernetes"],
      });
      expect(() => store.save(profile)).toThrowError(/Kubernetes/);
      expect(store.exists()).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
