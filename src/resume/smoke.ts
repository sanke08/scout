/**
 * Smoke script: builds resumes from the fictional fixtures for several keyword sets and, when
 * `pdflatex` is installed, compiles each one and prints its page count.
 *
 * Run it with `npx tsx src/resume/smoke.ts [outputDirectory]`. The output directory defaults to a
 * new folder under the system temp directory, so nothing is written into the repository.
 * It is a smoke target and not part of `npm test`: it needs LaTeX, which tests must not.
 *
 * Example output line: `sample / backend: 1 page (estimate 61.3 of 76.5), Alex_Rivera_ExampleCorp`.
 * Failure: exits with code 1 when any resume compiles to something other than one page, and
 * prints the reason when LaTeX is missing (then it only prints the estimates).
 */
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { profileSchema, ScoutError } from "../shared/index.js";
import type { Profile } from "../shared/index.js";
import { compileResume, createResumeBuilder } from "./index.js";

/** A named set of job keywords to build a resume for. */
interface KeywordSet {
  name: string;
  keywords: string[];
}

/** The job keyword sets tried against every profile: none, a few, many, and unsupported ones. */
const KEYWORD_SETS: KeywordSet[] = [
  { name: "no keywords", keywords: [] },
  { name: "backend", keywords: ["TypeScript", "Node.js", "PostgreSQL", "Kafka", "rate limiting"] },
  { name: "frontend", keywords: ["React", "Next.js", "Tailwind CSS", "code splitting", "Redis"] },
  { name: "go services", keywords: ["Go", "circuit breaker", "dead-letter queue", "REST APIs"] },
  { name: "unsupported", keywords: ["Kubernetes", "Terraform", "Rust", "TypeScript"] },
];

/** The fixture profiles to build from, by name. */
const PROFILE_FILES: Record<string, string> = {
  sample: "../../fixtures/profile.sample.json",
  large: "../../fixtures/resume/large-profile.json",
};

/** Reads and validates one fixture profile. */
async function loadProfile(relativePath: string): Promise<Profile> {
  const text = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return profileSchema.parse(JSON.parse(text));
}

/** Builds and compiles every keyword set for one profile; returns how many were not one page. */
async function smokeProfile(
  profileName: string,
  profile: Profile,
  outputRoot: string,
): Promise<number> {
  const builder = createResumeBuilder();
  let failures = 0;
  for (const set of KEYWORD_SETS) {
    const build = builder.build(profile, set.keywords, { company: "Example Corp" });
    const label = `${profileName} / ${set.name}`;
    const summary = `estimate ${build.estimatedLines} of ${build.lineLimit}, projects ${build.projectsShown.length}, ${build.fileStem}`;
    try {
      const directory = path.join(outputRoot, `${profileName}-${set.name.replace(/\W+/g, "-")}`);
      const compiled = await compileResume(build.texSource, directory, undefined, build.fileStem);
      const verdict = compiled.pageCount === 1 ? "ok" : "NOT ONE PAGE";
      console.log(`${label}: ${compiled.pageCount} page(s) ${verdict} (${summary})`);
      if (compiled.pageCount !== 1) failures += 1;
    } catch (error) {
      if (error instanceof ScoutError && error.code === "unavailable") {
        console.log(`${label}: not compiled, ${error.message} (${summary})`);
        continue;
      }
      throw error;
    }
  }
  return failures;
}

/** Entry point: runs every profile and sets the exit code. */
async function main(): Promise<void> {
  const outputRoot =
    process.argv[2] ?? (await mkdtemp(path.join(os.tmpdir(), "scout-resume-smoke-")));
  console.log(`Writing to ${outputRoot}`);
  let failures = 0;
  for (const [name, file] of Object.entries(PROFILE_FILES)) {
    failures += await smokeProfile(name, await loadProfile(file), outputRoot);
  }
  if (failures > 0) {
    console.log(`${failures} resume(s) were not exactly one page.`);
    process.exitCode = 1;
  }
}

await main();
