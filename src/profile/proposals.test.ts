import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileSchema, ScoutError, type Profile, type ProfileStore } from "../shared/index.js";
import { createProfileStore } from "./profile-store.js";
import { createProposalStore, type NewProposal } from "./proposals.js";

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

/** A valid proposal for the first point of the first job (which allows React). */
function validProposal(): NewProposal {
  return {
    target: { section: "experience", entryIndex: 0, pointIndex: 0 },
    text: "Built the booking flow in React, as one of four engineers.",
    keys: ["React"],
    claimCheck: "passed",
  };
}

describe("proposal store", () => {
  let folder: string;
  let profileStore: ProfileStore;
  let proposalsPath: string;
  let counter: number;

  const makeStore = () =>
    createProposalStore(proposalsPath, {
      now: () => new Date("2026-01-01T10:00:00.000Z"),
      newId: () => `proposal-${(counter += 1)}`,
    });

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "scout-proposals-"));
    proposalsPath = join(folder, "proposals.json");
    profileStore = createProfileStore(join(folder, "profile.json"));
    profileStore.save(sampleProfile());
    counter = 0;
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("starts empty and lists what was added, oldest first", () => {
    const store = makeStore();
    expect(store.list()).toEqual([]);
    const first = store.add(validProposal());
    const second = store.add(validProposal());
    expect(store.list().map((proposal) => proposal.id)).toEqual([first.id, second.id]);
    expect(first.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(first.id).not.toBe(second.id);
  });

  it("keeps proposals across new store objects (they are on disk)", () => {
    const added = makeStore().add(validProposal());
    expect(makeStore().list()).toEqual([added]);
  });

  it("never changes the profile until approved", () => {
    const before = profileStore.load();
    makeStore().add(validProposal());
    expect(profileStore.load()).toEqual(before);
  });

  it("rejects a malformed proposal with a sentence naming the field", () => {
    const error = thrownBy(() => makeStore().add({ ...validProposal(), text: "" }));
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("text");
  });

  it("approve adds the variant to the target point, bumps the version once and removes it", () => {
    const store = makeStore();
    const proposal = store.add(validProposal());
    const other = store.add(validProposal());
    const before = profileStore.load();
    const saved = store.approve(proposal.id, profileStore);
    expect(saved.version).toBe(before.version + 1);
    expect(profileStore.load().version).toBe(before.version + 1);
    const variants = saved.experience[0]?.points[0]?.variants ?? [];
    expect(variants.at(-1)).toEqual({ text: proposal.text, keys: proposal.keys });
    expect(variants).toHaveLength((before.experience[0]?.points[0]?.variants.length ?? 0) + 1);
    expect(store.list().map((remaining) => remaining.id)).toEqual([other.id]);
  });

  it("approve keeps the proposal and the profile when the wording uses a term not allowed", () => {
    const store = makeStore();
    const proposal = store.add({ ...validProposal(), keys: ["React", "Kafka"] });
    const before = profileStore.load();
    const error = thrownBy(() => store.approve(proposal.id, profileStore));
    expect(error.code).toBe("invalid-input");
    expect(profileStore.load()).toEqual(before);
    expect(store.list()).toHaveLength(1);
  });

  it("approve keeps the proposal when its target point no longer exists", () => {
    const store = makeStore();
    const proposal = store.add({
      ...validProposal(),
      target: { section: "projects", entryIndex: 0, pointIndex: 40 },
    });
    expect(thrownBy(() => store.approve(proposal.id, profileStore)).code).toBe("invalid-input");
    expect(store.list()).toHaveLength(1);
  });

  it("reject removes the proposal and leaves the profile alone", () => {
    const store = makeStore();
    const proposal = store.add(validProposal());
    const before = profileStore.load();
    store.reject(proposal.id);
    expect(store.list()).toEqual([]);
    expect(profileStore.load()).toEqual(before);
  });

  it("approve and reject throw not-found for an unknown id", () => {
    const store = makeStore();
    expect(thrownBy(() => store.approve("nope", profileStore)).code).toBe("not-found");
    expect(thrownBy(() => store.reject("nope")).code).toBe("not-found");
  });

  it("refuses a proposals file from a newer Scout and one with invalid content", () => {
    const store = makeStore();
    writeFileSync(proposalsPath, JSON.stringify({ schemaVersion: 2, proposals: [] }));
    expect(thrownBy(() => store.list()).message).toContain("newer Scout");
    writeFileSync(proposalsPath, JSON.stringify({ schemaVersion: 1, proposals: [{ id: 3 }] }));
    const error = thrownBy(() => store.list());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("proposals[0].id");
  });
});
