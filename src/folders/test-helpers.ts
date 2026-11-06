/**
 * Helpers shared by the folders tests: temporary folders, a fixed clock and a fictional posting.
 * Only test files import this file. All data is fictional and uses example.com addresses.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Posting } from "../shared/index.js";

/** Makes a fresh temporary folder and returns its path plus a function that deletes it. */
export function makeTemporaryFolder(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), "scout-folders-"));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/** A clock fixed at 2026-11-07 10:00 UTC. */
export function fixedClock(): () => Date {
  return () => new Date("2026-11-07T10:00:00.000Z");
}

/** A fictional posting. Pass overrides to change fields. */
export function makePosting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    company: "ExampleCorp",
    title: "Backend Engineer",
    location: "Remote",
    remote: "remote",
    seniority: "mid",
    skills: ["Node.js"],
    description:
      "Build services for Alex Rivera's fictional team.\n\n## Notes\n  Keep   spacing & <tags> | pipes.\n",
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-01T00:00:00.000Z",
    sources: [{ name: "greenhouse:examplecorp", url: "https://example.com/jobs/1" }],
    canonicalUrl: "https://example.com/jobs/1",
    board: "greenhouse",
    flags: [],
    ...overrides,
  };
}
