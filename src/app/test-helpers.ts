/**
 * Helpers shared by the app module's unit tests: a temporary data folder with the sample profile,
 * an application wired to a fake discovery and a fixed clock, and a brain that answers from a
 * function. Only test files import this file.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brain, BrainRequest, BrainResult, Discovery, Posting } from "../shared/index.js";
import { createApplication, type Application, type ApplicationOptions } from "./application.js";

/** The moment the unit tests treat as "now". */
export const TEST_NOW = new Date("2026-11-07T10:00:00.000Z");

/** An application over a fresh temporary folder, plus a function that closes and deletes it. */
export interface TestApplication {
  application: Application;
  directory: string;
  cleanUp: () => void;
}

/**
 * Creates an application in a temporary folder with the fictional sample profile installed.
 * `postings` is what the one watched board (greenhouse:testboard) returns. Extra `options` win.
 */
export function makeTestApplication(
  postings: Posting[],
  options: ApplicationOptions = {},
  installProfile = true,
): TestApplication {
  const directory = mkdtempSync(join(tmpdir(), "scout-app-"));
  if (installProfile) copyFileSync("fixtures/profile.sample.json", join(directory, "profile.json"));
  const discovery: Discovery = { fetchBoard: async () => postings };
  const application = createApplication({
    directory,
    now: () => TEST_NOW,
    discovery,
    ...options,
  });
  application.boardStore.add({ kind: "greenhouse", token: "testboard" });
  return {
    application,
    directory,
    cleanUp: () => {
      application.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * A fictional posting that passes every hard rule for the sample profile (mid level, hybrid in
 * Berlin, no stated salary, matching skills). `number` makes its id, title and address unique.
 */
export function makeNumberedPosting(number: number, changes: Partial<Posting> = {}): Posting {
  const address = `https://boards.example.com/northwind/${number}`;
  return {
    id: `posting-${number}`,
    company: "Northwind Labs",
    title: `Backend Engineer ${number}`,
    location: "Berlin, Germany",
    remote: "hybrid",
    seniority: "mid",
    skills: ["Node.js", "TypeScript", "PostgreSQL"],
    description: "Build and run services for our booking product with a small team.",
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-05T00:00:00.000Z",
    sources: [{ name: "greenhouse:northwind", url: address }],
    canonicalUrl: address,
    board: "greenhouse",
    flags: [],
    ...changes,
  };
}

/** What a scripted brain says about one posting. */
export interface ScriptedScore {
  eligibility: number;
  desirability: number;
  unmetRequirements?: string[];
  unknownRequirements?: string[];
}

/**
 * A brain that scores each posting with `scoreOf(postingId)` and records every batch it saw.
 * The reply passes through the request's schema like a real one.
 */
export function makeScriptedBrain(
  scoreOf: (postingId: string) => ScriptedScore | undefined,
): Brain & {
  batches: string[][];
} {
  const batches: string[][] = [];
  return {
    name: "scripted",
    batches,
    async run<T>(request: BrainRequest<T>): Promise<BrainResult<T>> {
      const postings = JSON.parse(request.untrustedText ?? "[]") as { id: string }[];
      batches.push(postings.map((posting) => posting.id));
      const scores = postings.flatMap((posting) => {
        const score = scoreOf(posting.id);
        if (score === undefined) return [];
        return [
          {
            postingId: posting.id,
            eligibility: score.eligibility,
            desirability: score.desirability,
            reasons: ["First reason.", "Second reason.", "Third reason."],
            unmetRequirements: score.unmetRequirements ?? [],
            unknownRequirements: score.unknownRequirements ?? [],
            redFlags: [],
          },
        ];
      });
      return {
        ok: true,
        value: request.schema.parse({ scores }),
        engine: "scripted",
        cached: false,
      };
    },
  };
}
