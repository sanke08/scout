/**
 * `scout resume --job <jobId>`: builds the resume for a stored job and saves it in the job's folder.
 *
 * Why it exists: the keywords of a stored job are already known (its skills), so the user should
 * not retype them, and the resume belongs next to the job description it was made for.
 * The job's status is left alone; only `resume_tailored` and the log line change in `job.md`.
 *
 * Example: `scout resume --job 3f2a... --compile` writes `Alex_Rivera_Northwind.tex` and `.pdf`
 * into `jobs/2026-11-07_Northwind_Backend-Engineer/`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileResume } from "../../resume/index.js";
import { ScoutError } from "../../shared/index.js";
import type { Application } from "../application.js";

/** What the `resume` command gives besides the job id. */
export interface JobResumeOptions {
  /** Extra comma-separated keywords added to the job's own skills. */
  keywords?: string | undefined;
  /** A company name that replaces the job's own in the file name. */
  company?: string | undefined;
  /** Also build the PDF (needs `pdflatex`). */
  compile?: boolean | undefined;
  /** Not allowed together with a job: the folder is always the job's own. */
  out?: string | undefined;
}

/** Skills first, then the given keywords, without repeats (compared ignoring case). */
function mergeKeywords(skills: string[], given: string | undefined): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const extra = (given ?? "").split(",").map((keyword) => keyword.trim());
  for (const keyword of [...skills, ...extra]) {
    if (keyword === "" || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    merged.push(keyword);
  }
  return merged;
}

/**
 * Builds and saves the resume for one stored job, printing what was saved and what was left out.
 * Failure: an unknown job id is `not-found`; `--out` with `--job` is `invalid-input`; a missing
 * profile or `pdflatex` fails as it does for `scout resume` without a job.
 */
export async function buildResumeForJob(
  application: Application,
  jobId: string,
  options: JobResumeOptions,
): Promise<void> {
  if (options.out !== undefined) {
    throw new ScoutError(
      "invalid-input",
      "The --out option cannot be used with --job, because the resume is saved in the job's own folder. Remove --out.",
    );
  }
  const job = application.jobStore.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists. Run "scout jobs" to see the job ids.`,
    );
  }
  const profile = application.profileStore.load();
  const build = application.resumeBuilder.build(
    profile,
    mergeKeywords(job.skills, options.keywords),
    {
      company: options.company ?? job.company,
    },
  );
  const folder = application.folders.ensureJobFolder(job);
  let saved: string[];
  if (options.compile === true) {
    const scratch = await mkdtemp(join(tmpdir(), "scout-resume-"));
    try {
      const compiled = await compileResume(build.texSource, scratch, undefined, build.fileStem);
      saved = application.folders.saveTailoredResume(folder.name, {
        fileStem: build.fileStem,
        texSource: build.texSource,
        pdfPath: compiled.pdfPath,
      });
      if (compiled.pageCount !== 1) {
        console.log(
          `Warning: the resume is ${compiled.pageCount} pages, not one. Remove a point or a project from your profile.`,
        );
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else {
    saved = application.folders.saveTailoredResume(folder.name, {
      fileStem: build.fileStem,
      texSource: build.texSource,
    });
  }
  for (const name of saved) console.log(`Wrote ${join(folder.path, name)}`);
  console.log(`Projects shown: ${build.projectsShown.join(", ") || "none"}`);
  console.log(`Projects left out: ${build.projectsLeftOut.join(", ") || "none"}`);
  console.log(`Keywords matched: ${build.matchedKeywords.join(", ") || "none"}`);
  console.log(`Not in your profile, so not added: ${build.notInProfile.join(", ") || "none"}`);
  console.log(`Estimated length: ${build.estimatedLines} of ${build.lineLimit} lines`);
}
