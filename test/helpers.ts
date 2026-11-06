/**
 * Helpers shared by the end-to-end tests: a temporary data folder, a fake network that serves the
 * saved boards in `fixtures/boards`, a scoring brain that needs no model, and a way to run the
 * real entry point and capture what it prints.
 *
 * Only test files import this file. Everything here is fictional: no network, no real model.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { ApplicationOptions } from "../src/app/index.js";
import { main } from "../src/index.js";
import type { Brain, BrainRequest, BrainResult } from "../src/shared/index.js";

/** The moment every end-to-end test treats as "now". */
export const FIXED_NOW = new Date("2026-11-07T10:00:00.000Z");

/** A fresh temporary data folder and the function that deletes it. */
export function makeDataFolder(): { directory: string; remove: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "scout-e2e-"));
  return { directory, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * The Greenhouse answer for a made-up company "harborjobs" with one junior role that fits the
 * sample profile: Berlin, Node.js and TypeScript, a salary above the floor. Written in the shape
 * the real Greenhouse API uses (the description is escaped HTML).
 */
export function harborJobsBoard(): string {
  const description =
    "&lt;p&gt;Harbor Jobs builds booking tools. You will build APIs in Node.js and TypeScript, " +
    "model data in PostgreSQL and use Redis for caching. Hybrid in our Berlin office. " +
    "Salary: €65,000 - €75,000 per year.&lt;/p&gt;";
  return JSON.stringify({
    jobs: [
      {
        id: 9100001,
        internal_job_id: 1,
        title: "Backend Engineer",
        updated_at: "2026-11-01T08:00:00-04:00",
        first_published: "2026-11-01T08:00:00-04:00",
        requisition_id: "HJ-1",
        location: { name: "Berlin, Germany" },
        absolute_url: "https://boards.greenhouse.io/harborjobs/jobs/9100001",
        company_name: "Harborjobs",
        content: description,
        departments: [{ id: 1, name: "Engineering" }],
        offices: [{ id: 2, name: "Berlin" }],
      },
    ],
    meta: { total: 1 },
  });
}

/** Maps part of a board address to the text served for it. */
const BOARD_RESPONSES: Record<string, () => string> = {
  "boards/examplecorp/jobs": () =>
    readFileSync("fixtures/boards/greenhouse-examplecorp.json", "utf8"),
  "postings/examplecorp": () => readFileSync("fixtures/boards/lever-examplecorp.json", "utf8"),
  "job-board/examplecorp": () => readFileSync("fixtures/boards/ashby-examplecorp.json", "utf8"),
  "boards/harborjobs/jobs": harborJobsBoard,
};

/** The addresses asked for so far, so a test can check what was (not) fetched. */
export interface FakeNetwork {
  fetchImpl: (url: string) => Promise<Response>;
  requested: string[];
}

/** A fake network: known boards answer with saved text, anything else answers 404 like a missing board. */
export function makeFakeNetwork(): FakeNetwork {
  const requested: string[] = [];
  return {
    requested,
    fetchImpl: async (url) => {
      requested.push(url);
      for (const [part, body] of Object.entries(BOARD_RESPONSES)) {
        if (url.includes(part)) return new Response(body(), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    },
  };
}

/** A brain that scores every posting it is shown, and counts the requests it received. */
export interface ScoringBrain extends Brain {
  requestCount(): number;
}

/**
 * A model stand-in that needs no model: for each posting inside the untrusted text it returns a
 * valid score. An engineering role gets `eligibility` and `desirability` as given; any other role
 * (a designer, an analyst) gets 10 for both, so it falls below the shortlist. The reply goes
 * through the request's own schema, so a reply that the real caller would reject fails here too.
 */
export function makeScoringBrain(eligibility: number, desirability: number): ScoringBrain {
  let requests = 0;
  return {
    name: "scoring-fake",
    requestCount: () => requests,
    async run<T>(request: BrainRequest<T>): Promise<BrainResult<T>> {
      requests += 1;
      const postings = JSON.parse(request.untrustedText ?? "[]") as { id: string; title: string }[];
      const value = request.schema.parse({
        scores: postings.map((posting) => ({
          postingId: posting.id,
          eligibility: /engineer/i.test(posting.title) ? eligibility : 10,
          desirability: /engineer/i.test(posting.title) ? desirability : 10,
          reasons: ["Matches your Node.js work.", "Location fits.", "Salary is above your floor."],
          unmetRequirements: [],
          unknownRequirements: [],
          redFlags: [],
        })),
      });
      return { ok: true, value, engine: "scoring-fake", cached: false };
    },
  };
}

/** What running the program printed and how it ended. */
export interface CliResult {
  /** Lines written to standard output, in order. */
  lines: string[];
  /** Lines written to standard error, in order. */
  errors: string[];
  /** The exit code the program set, or 0 when it set none. */
  exitCode: number;
}

/**
 * Runs the real entry point `main(argv)` with the given overrides and captures its output.
 * Example: `await runCli(["jobs"], { directory })` returns the printed lines of `scout jobs`.
 */
export async function runCli(args: string[], overrides: ApplicationOptions): Promise<CliResult> {
  const lines: string[] = [];
  const errors: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.join(" "));
  });
  process.exitCode = undefined;
  try {
    await main(["node", "scout", ...args], overrides);
    return { lines, errors, exitCode: Number(process.exitCode ?? 0) };
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = undefined;
  }
}
