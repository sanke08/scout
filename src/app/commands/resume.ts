/**
 * `scout resume`: builds a one-page resume for a job's keywords and writes the LaTeX source.
 *
 * Why it exists: scenario C. The user pastes the keywords of a job and gets a resume made only of
 * wording the profile already holds. A keyword the profile does not support is listed as "not in
 * your profile, so not added" and never appears in the output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { compileResume } from "../../resume/index.js";
import type { ApplicationOptions } from "../application.js";
import { buildResumeForJob } from "./folders-resume.js";
import { withApplication } from "./with-application.js";

/** The options of the command as commander hands them over. */
interface ResumeCommandOptions {
  keywords?: string;
  company?: string;
  compile?: boolean;
  out?: string;
  job?: string;
}

/** Splits "a, b,c" into ["a", "b", "c"], dropping empty pieces. */
function splitKeywords(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword !== "");
}

/** Registers `resume` on the program. */
export function registerResume(program: Command, overrides: ApplicationOptions): void {
  program
    .command("resume")
    .description("Build a one-page resume for a job's keywords from your profile.")
    .option("--keywords <list>", 'comma-separated job keywords, e.g. "Node.js,Kafka"')
    .option("--company <name>", "company name, used in the file name")
    .option("--compile", "also compile the PDF with pdflatex (must be installed)")
    .option(
      "--out <folder>",
      "folder to write into (default: the resumes folder of your data folder)",
    )
    .option(
      "--job <jobId>",
      "build for a stored job (its skills plus --keywords) and save into the job's folder",
    )
    .action((options: ResumeCommandOptions) =>
      withApplication(overrides, async (application) => {
        if (options.job !== undefined) {
          await buildResumeForJob(application, options.job, options);
          return;
        }
        const profile = application.profileStore.load();
        const build = application.resumeBuilder.build(profile, splitKeywords(options.keywords), {
          ...(options.company === undefined ? {} : { company: options.company }),
        });
        const outputFolder = resolve(options.out ?? join(application.directory, "resumes"));
        mkdirSync(outputFolder, { recursive: true });
        if (options.compile === true) {
          const compiled = await compileResume(
            build.texSource,
            outputFolder,
            undefined,
            build.fileStem,
          );
          console.log(`Wrote ${join(outputFolder, `${build.fileStem}.tex`)}`);
          console.log(
            `Wrote ${compiled.pdfPath} (${compiled.pageCount} page${compiled.pageCount === 1 ? "" : "s"})`,
          );
          if (compiled.pageCount !== 1) {
            console.log(
              "Warning: the resume is not exactly one page. Remove a point or a project from your profile.",
            );
          }
        } else {
          const texPath = join(outputFolder, `${build.fileStem}.tex`);
          writeFileSync(texPath, build.texSource, "utf8");
          console.log(`Wrote ${texPath}`);
        }
        console.log(`Projects shown: ${build.projectsShown.join(", ") || "none"}`);
        console.log(`Projects left out: ${build.projectsLeftOut.join(", ") || "none"}`);
        console.log(`Keywords matched: ${build.matchedKeywords.join(", ") || "none"}`);
        console.log(
          `Not in your profile, so not added: ${build.notInProfile.join(", ") || "none"}`,
        );
        console.log(`Estimated length: ${build.estimatedLines} of ${build.lineLimit} lines`);
      }),
    );
}
