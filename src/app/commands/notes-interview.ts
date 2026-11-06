/**
 * `scout interview <jobId> [--save] [--no-model]`: prepares the user for an interview.
 *
 * Why it exists: IDEA 5.13. When an invite arrives the user needs the job's core requirements,
 * the stories to tell from the resume that was sent, honest answers for gaps and likely rounds.
 * The plan is built by the insight module; this command only gathers its inputs and prints it.
 *
 * Inputs: the stored job and its saved description; the resume points as sent (the tailored
 * resume saved in the job's folder when there is one, otherwise a resume built from the profile's
 * usable points for this job's skills); the profile. The model, when it works, adds practice
 * questions; when it does not, the plan is built from rules alone and says so.
 *
 * `--save` writes the plan into the job folder's "Interview prep" section (through
 * `application.folders`) when that folder exists, otherwise into `<data folder>/interview/<jobId>.md`, and the command says which.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { buildInterviewPlan, type ResumePointSent } from "../../insight/index.js";
import { ScoutError, type Brain, type JobRecord, type Profile } from "../../shared/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { resumePointsFromTex } from "./notes-resume-points.js";
import { withApplication } from "./with-application.js";

/** The folder of job folders inside the data folder (where `application.folders` keeps them). */
const JOBS_FOLDER_NAME = "jobs";

/** The characters a job id may have for Scout to use it as a file name. */
const SAFE_JOB_ID = /^[A-Za-z0-9_-]+$/;

/** The resume points to prepare from, and a plain-words note on where they came from. */
interface ResumeSource {
  points: ResumePointSent[];
  description: string;
}

/** The first `.tex` file (by name) directly inside a job folder, or undefined. */
function savedResumeSource(folderPath: string): string | undefined {
  const names = readdirSync(folderPath)
    .filter((name) => name.endsWith(".tex"))
    .sort();
  const first = names[0];
  return first === undefined ? undefined : join(folderPath, first);
}

/**
 * Finds the resume points: the tailored resume in the job's folder if there is one, else a
 * resume built from the profile for the job's skills (the builder ranks the points by the skills).
 */
function resumeSourceFor(
  application: Application,
  profile: Profile,
  job: JobRecord,
  folderPath: string | undefined,
): ResumeSource {
  const savedPath = folderPath === undefined ? undefined : savedResumeSource(folderPath);
  if (savedPath !== undefined) {
    return {
      points: resumePointsFromTex(readFileSync(savedPath, "utf8")),
      description: `the resume saved in the job folder (${savedPath})`,
    };
  }
  const build = application.resumeBuilder.build(profile, job.skills, { company: job.company });
  return {
    points: resumePointsFromTex(build.texSource),
    description:
      "none is saved for this job, so a resume was built from your profile's usable points for the job's skills",
  };
}

/** The brain for practice questions, or undefined when it cannot be built (the plan then has none). */
function brainOrUndefined(application: Application): Brain | undefined {
  try {
    return application.brain();
  } catch (error) {
    if (error instanceof ScoutError) return undefined;
    throw error;
  }
}

/** Saves the plan; returns the sentence that tells the user where it went. */
function savePlan(
  application: Application,
  job: JobRecord,
  folderName: string | undefined,
  markdown: string,
): string {
  if (folderName !== undefined) {
    application.folders.writeSection(folderName, "Interview prep", markdown);
    return `Saved the plan in the "Interview prep" section of the job folder ${folderName}.`;
  }
  const folder = join(application.directory, "interview");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${job.id}.md`);
  writeFileSync(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return `This job has no job folder yet, so the plan was saved to ${path} instead.`;
}

/** Runs the command for one job id. */
async function interview(
  application: Application,
  jobId: string,
  options: { save?: boolean; model?: boolean },
): Promise<void> {
  const job = application.jobStore.get(jobId);
  if (job === undefined) {
    throw new ScoutError(
      "not-found",
      `No job with id ${jobId} exists. Run \`scout jobs\` to see the ids.`,
    );
  }
  if (!SAFE_JOB_ID.test(job.id)) {
    throw new ScoutError(
      "unsafe",
      "This job's id has characters that cannot be used in a file name, so Scout stopped.",
    );
  }
  const profile = application.profileStore.load();
  const folderName = application.folders.findJobFolder(job);
  const resume = resumeSourceFor(
    application,
    profile,
    job,
    folderName === undefined
      ? undefined
      : join(application.directory, JOBS_FOLDER_NAME, folderName),
  );
  const brain = options.model === false ? undefined : brainOrUndefined(application);
  const { markdown } = await buildInterviewPlan({
    job: { company: job.company, title: job.title, skills: job.skills },
    jobDescription: job.description,
    resumeSent: resume.points,
    profile,
    ...(brain === undefined ? {} : { brain }),
  });
  console.log(markdown);
  console.log(`Resume points used: ${resume.description}.`);
  if (options.save === true) console.log(savePlan(application, job, folderName, markdown));
}

/** Registers `interview` on the program. */
export function registerInterview(program: Command, overrides: ApplicationOptions): void {
  program
    .command("interview <jobId>")
    .description("Prepare for an interview: requirements, stories, honest answers for gaps.")
    .option("--save", "save the plan in the job folder (or the interview folder)")
    .option("--no-model", "do not ask the model for extra practice questions")
    .action((jobId: string, options: { save?: boolean; model?: boolean }) =>
      withApplication(overrides, (application) => interview(application, jobId, options)),
    );
}
