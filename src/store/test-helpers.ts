/**
 * Helpers shared by the store tests: temporary folders, a fixed clock and a fictional posting.
 * Only test files import this file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Posting } from "../shared/index.js";

/** Makes a fresh temporary folder and returns its path plus a function that deletes it. */
export function makeTemporaryFolder(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "scout-store-"));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/** A clock that returns one more minute each time it is read, starting at 2026-01-01T00:00:00Z. */
export function makeTickingClock(): () => Date {
  let minutes = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, minutes++));
}

/** A fictional posting. Pass overrides to change fields. Uses only example.com addresses. */
export function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    company: "ExampleCorp",
    title: "Backend Engineer",
    location: "Remote",
    remote: "remote",
    seniority: "mid",
    skills: ["Node.js"],
    description: "Build services for Alex Rivera's fictional team.",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    sources: [{ name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" }],
    canonicalUrl: "https://example.com/jobs/1",
    board: "greenhouse",
    flags: [],
    ...overrides,
  };
}
