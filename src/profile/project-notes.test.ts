import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { draftPointsFromNote, loadProjectNotes, parseProjectNote } from "./project-notes.js";

const fullNote = `# Message Queue

## Overview
A small queue server written for learning.
It has an HTTP API.

## Verdict
Real, built by the user; not tutorial-derived.

## Stack
- Go
- HTTP API
PostgreSQL, Go

## Features
- Publishes messages to named queues with Go.
- Leases a claimed message and requeues it if unacknowledged,
  so a stalled consumer does not lose work.
- Counts messages per queue.

## Do not claim
- Used in production
- Handles millions of messages

## Scratch
ignored text
`;

describe("parseProjectNote", () => {
  it("reads every fixed section", () => {
    const note = parseProjectNote("message-queue.md", fullNote);
    expect(note.title).toBe("Message Queue");
    expect(note.overview).toBe("A small queue server written for learning. It has an HTTP API.");
    expect(note.verdict).toContain("not tutorial-derived");
    expect(note.stack).toEqual(["Go", "HTTP API", "PostgreSQL"]);
    expect(note.features).toHaveLength(3);
    expect(note.features[1]).toContain("so a stalled consumer does not lose work.");
    expect(note.doNotClaim).toEqual(["Used in production", "Handles millions of messages"]);
  });

  it("is tolerant of missing sections and of heading capitalisation", () => {
    const note = parseProjectNote("small.md", "# Tiny\n\n## STACK\n- Rust\n");
    expect(note).toMatchObject({
      title: "Tiny",
      overview: "",
      verdict: "",
      features: [],
      doNotClaim: [],
      stack: ["Rust"],
    });
  });

  it("rejects a note with no title, naming the file", () => {
    let thrown: unknown;
    try {
      parseProjectNote("untitled.md", "## Stack\n- Go\n");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScoutError);
    expect((thrown as ScoutError).code).toBe("invalid-input");
    expect((thrown as ScoutError).message).toContain("untitled.md");
  });

  it("does not take a second-level heading for the title", () => {
    expect(() => parseProjectNote("x.md", "## Overview\ntext")).toThrow(ScoutError);
  });
});

describe("draftPointsFromNote", () => {
  it("drafts hold points whose terms are only stack terms the feature mentions", () => {
    const note = parseProjectNote("message-queue.md", fullNote);
    const drafts = draftPointsFromNote(note);
    expect(drafts).toHaveLength(note.features.length);
    for (const draft of drafts) {
      expect(draft.status).toBe("hold");
      expect(draft.variants).toEqual([]);
      for (const term of draft.allowed) {
        expect(note.stack).toContain(term);
        expect(draft.text).toContain(term);
      }
    }
    expect(drafts[0]?.allowed).toEqual(["Go"]);
    expect(drafts[2]?.allowed).toEqual([]);
  });

  it("never invents a term the stack does not list", () => {
    const note = parseProjectNote(
      "n.md",
      "# N\n## Stack\n- Go\n## Features\n- Cached results in Redis.\n",
    );
    expect(draftPointsFromNote(note)[0]?.allowed).toEqual([]);
  });

  it("matches whole words only and handles terms with symbols", () => {
    const note = parseProjectNote(
      "n.md",
      "# N\n## Stack\n- Go\n- C++\n- Node.js\n## Features\n- Goroutines in C++ and Node.js code.\n",
    );
    expect(draftPointsFromNote(note)[0]?.allowed).toEqual(["C++", "Node.js"]);
  });
});

describe("loadProjectNotes", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "scout-notes-"));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("loads only Markdown files, sorted by name", () => {
    writeFileSync(join(folder, "b.md"), "# Beta\n");
    writeFileSync(join(folder, "a.md"), "# Alpha\n");
    writeFileSync(join(folder, "readme.txt"), "not a note");
    mkdirSync(join(folder, "nested.md"));
    expect(loadProjectNotes(folder).map((note) => note.title)).toEqual(["Alpha", "Beta"]);
  });

  it("gives an empty list for a folder that does not exist", () => {
    expect(loadProjectNotes(join(folder, "missing"))).toEqual([]);
  });

  it("rejects a note with no title and names the file", () => {
    writeFileSync(join(folder, "bad.md"), "just text, no heading\n");
    expect(() => loadProjectNotes(folder)).toThrow(/bad\.md/);
  });
});
