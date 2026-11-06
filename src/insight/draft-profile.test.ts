import { describe, expect, it } from "vitest";
import { parseProjectNote } from "../profile/index.js";
import { draftProfileFromNotes } from "./draft-profile.js";

/** A fictional note in the verified format. */
const noteText = `# Pocket Queue

## Verdict
Unfinished. No acknowledge route.

## Stack
- TypeScript
- Express
- Docker

## Features
- Leases claimed messages with Express so a stalled consumer loses nothing.
- Packaged with Docker.
- Counts messages per queue.

## Do not claim
- Used in production
`;

describe("draftProfileFromNotes", () => {
  const drafts = draftProfileFromNotes([parseProjectNote("pocket-queue.md", noteText)]);

  it("drafts one project per note with one point per feature", () => {
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.entry.title).toBe("Pocket Queue");
    expect(drafts[0]?.entry.points).toHaveLength(3);
  });

  it("gives every point the hold status, so no resume can use it before review", () => {
    for (const point of drafts.flatMap((draft) => draft.entry.points)) {
      expect(point.status).toBe("hold");
      expect(point.variants).toEqual([]);
    }
  });

  it("allows only terms from the note's stack that the feature mentions", () => {
    const stack = ["TypeScript", "Express", "Docker"];
    const points = drafts[0]?.entry.points ?? [];
    for (const point of points) {
      for (const term of point.allowed) {
        expect(stack).toContain(term);
      }
    }
    expect(points[0]?.allowed).toEqual(["Express"]);
    expect(points[2]?.allowed).toEqual([]);
  });

  it("carries the verdict and the do-not-claim list for the reviewer", () => {
    expect(drafts[0]?.verdict).toMatch(/^Unfinished/);
    expect(drafts[0]?.doNotClaim).toEqual(["Used in production"]);
    expect(drafts[0]?.sourceNote).toBe("pocket-queue.md");
  });
});
