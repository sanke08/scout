/**
 * The resume tool: `build_resume`.
 *
 * Why it exists: the model decides which keywords and points to stress for one job; Scout only
 * arranges the fixed LaTeX template from text the owner stored or approved. The fact check lives in
 * the builder: held, excluded and ask-first points are never used and a keyword the profile does not
 * hold is never added (it comes back in `keywordsRefused`).
 *
 * Pause: building a resume only writes files in the data folder and fetches or sends nothing, so
 * the tool keeps working while Scout is paused (the kill switch stops submitting and filling).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveApplyEnvironment } from "../../app/commands/apply-environment.js";
import { ScoutError, USABLE_POINT_STATUSES, type Point, type Profile } from "../../shared/index.js";
import { okOutside, outside, type ScoutTool } from "../tool.js";
import { JOB_ID_LIMIT, safely, type ActToolOptions } from "./act-support.js";

/** The longest file path returned to the model; a real path is far shorter. */
const MAXIMUM_PATH_CHARACTERS = 1000;

/** The most keywords one resume is built for. */
const KEYWORD_LIMIT = 40;

/** One entry of the profile the model wants to stress, with the stored positions of its points. */
const pointChoiceSchema = z.object({
  section: z.enum(["experience", "project"]),
  name: z.string().trim().min(1).max(160),
  points: z.array(z.number().int().min(0).max(50)).min(1).max(20),
});

/** What `build_resume` accepts. */
export const buildResumeInput = z.object({
  jobId: z.string().min(1).max(JOB_ID_LIMIT),
  keywords: z.array(z.string().trim().min(1).max(60)).max(KEYWORD_LIMIT),
  pointChoices: z.array(pointChoiceSchema).max(20).optional(),
});

/** A point's letters and digits only, lower case, so a printed line can be matched to its stored text. */
function canonical(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

/** True when the owner's rules allow the point on a resume. */
function isUsable(point: Point): boolean {
  return USABLE_POINT_STATUSES.includes(point.status) && point.text.trim() !== "";
}

/**
 * Keeps, for each entry the model named, only the points it chose. The points are the owner's own
 * and are not changed, so the fact check still applies to every word. A point that may not be used
 * (held, excluded, ask first) is refused with the reason, so the model can choose again.
 * Failure: `ScoutError("invalid-input")` for an unknown entry, a position that does not exist, or a point that may not be used.
 */
function restrictProfile(profile: Profile, choices: z.infer<typeof pointChoiceSchema>[]): Profile {
  const restricted: Profile = structuredClone(profile);
  for (const choice of choices) {
    const entries =
      choice.section === "experience"
        ? restricted.experience.map((entry) => ({ name: entry.org, alias: entry.title, entry }))
        : restricted.projects.map((entry) => ({ name: entry.title, alias: entry.title, entry }));
    const wanted = choice.name.toLowerCase();
    const matches = entries.filter(
      (item) => item.name.toLowerCase() === wanted || item.alias.toLowerCase() === wanted,
    );
    if (matches.length !== 1 || matches[0] === undefined) {
      const known = entries.map((item) => `"${item.name}"`).join(", ");
      throw new ScoutError(
        "invalid-input",
        matches.length === 0
          ? `The profile has no ${choice.section} named "${choice.name}". Its ${choice.section} entries are: ${known}.`
          : `More than one ${choice.section} is named "${choice.name}". Use the full name (company for a job, title for a project).`,
      );
    }
    const chosen = matches[0].entry;
    const originalPoints = chosen.points;
    const kept: Point[] = [];
    for (const position of [...new Set(choice.points)].sort((first, second) => first - second)) {
      const point = originalPoints[position];
      if (point === undefined) {
        throw new ScoutError(
          "invalid-input",
          `"${choice.name}" has ${originalPoints.length} points (positions 0 to ${originalPoints.length - 1}), so position ${position} does not exist.`,
        );
      }
      if (!isUsable(point)) {
        throw new ScoutError(
          "invalid-input",
          `Point ${position} of "${choice.name}" has status "${point.status}" and may not be used: held, excluded and ask-first points are never put on a resume. Choose another point.`,
        );
      }
      kept.push(point);
    }
    chosen.points = kept;
  }
  return restricted;
}

/** The lines the LaTeX prints as resume points, in the order they appear. */
function printedPoints(texSource: string): Set<string> {
  const printed = new Set<string>();
  for (const line of texSource.split("\n")) {
    const match = /^\s*\\resumeItem\{(.*)\}\s*$/.exec(line);
    if (match?.[1] !== undefined) printed.add(canonical(match[1]));
  }
  return printed;
}

/** Which stored points ended up on the page: section, entry name and the stored position. */
function pointsOnPage(
  profile: Profile,
  texSource: string,
): { section: string; name: string; position: number }[] {
  const printed = printedPoints(texSource);
  const found: { section: string; name: string; position: number }[] = [];
  const look = (section: string, name: string, points: Point[]): void => {
    points.forEach((point, position) => {
      if (!isUsable(point)) return;
      const wordings = [point.text, ...point.variants.map((variant) => variant.text)];
      if (wordings.some((wording) => printed.has(canonical(wording)))) {
        found.push({ section, name, position });
      }
    });
  };
  for (const entry of profile.experience) look("experience", entry.org, entry.points);
  for (const entry of profile.projects) look("project", entry.title, entry.points);
  return found;
}

/** The resume tools, built on the outside effects given (LaTeX compile comes from `apply`). */
export function createResumeTools(options: ActToolOptions): ScoutTool[] {
  const environment = resolveApplyEnvironment(options.apply);

  const buildResume: ScoutTool<typeof buildResumeInput> = {
    name: "build_resume",
    description:
      "Builds the one-page tailored resume for one job and saves it in the job's folder. YOU choose the keywords (the skills and terms from the posting that matter) and, optionally, which stored points to stress; Scout only arranges the owner's fixed LaTeX template from text the owner stored or approved. " +
      "Fact check, always on: a keyword the profile does not support is NEVER added (it is listed in keywordsRefused, and the resume is still saved without it), and held, excluded or ask-first points are never used (choosing one in pointChoices is refused with the reason). " +
      'Input: jobId; keywords (up to 40 words or short phrases); pointChoices (optional): for a job give section "experience" and the company name, for a project give section "project" and its title, and points as 0-based positions in that entry\'s stored list; only those points of that entry are then eligible (the first usable one is always shown). Entries you do not name keep the builder\'s own selection. ' +
      "Returns: path (the PDF when one was built, else the .tex), texPath, pdfPath (null when there is no PDF), pageFit (estimatedLines against lineLimit, and pages when a PDF was compiled; if it is more than one page, call again with fewer or shorter points), pointsUsed, keywordsUsed, keywordsRefused, projectsShown, projectsLeftOut and the job's status (a shortlisted job becomes resume-ready). " +
      "A PDF is built only when LaTeX (pdflatex) is installed; if it is not, the .tex is saved, pdfPath is null and a note says so, and apply_to_job cannot upload a resume until the owner installs LaTeX. Works while Scout is paused (it only writes local files).",
    inputSchema: buildResumeInput,
    readOnly: false,
    handler: (input, context) =>
      safely(async () => {
        const { application } = context;
        const job = application.jobStore.get(input.jobId);
        if (job === undefined) {
          throw new ScoutError(
            "not-found",
            `No job with id ${input.jobId} exists. Use the ids the job tools return.`,
          );
        }
        const profile = application.profileStore.load();
        const source =
          input.pointChoices === undefined ? profile : restrictProfile(profile, input.pointChoices);
        const build = application.resumeBuilder.build(source, input.keywords, {
          company: job.company,
        });

        let compiledPdf: string | undefined;
        let pageCount: number | undefined;
        let pdfNote: string | undefined;
        const scratch = await mkdtemp(join(tmpdir(), "scout-resume-"));
        try {
          try {
            const compiled = await environment.compileResume(
              build.texSource,
              scratch,
              build.fileStem,
            );
            compiledPdf = compiled.pdfPath;
            pageCount = compiled.pageCount;
          } catch (error) {
            if (!(error instanceof ScoutError) || error.code !== "unavailable") throw error;
            pdfNote = `No PDF was built: ${error.message} The .tex source is saved.`;
          }
          const folder = application.folders.ensureJobFolder(job);
          application.folders.saveTailoredResume(folder.name, {
            fileStem: build.fileStem,
            texSource: build.texSource,
            ...(compiledPdf === undefined ? {} : { pdfPath: compiledPdf }),
          });
          const texPath = join(folder.path, `${build.fileStem}.tex`);
          const pdfPath =
            compiledPdf === undefined ? null : join(folder.path, `${build.fileStem}.pdf`);
          if (job.status === "shortlisted") {
            application.jobStore.transition(job.id, "resume-ready", "Resume built by autopilot.");
          }
          context.note(
            `build_resume ${job.id}: ${build.matchedKeywords.length} keywords used, ${build.notInProfile.length} refused`,
          );
          // The folder name is made from the posting's company and title (outside words), so each
          // path is cleaned and the fields are named in outsideFields.
          return okOutside(
            {
              jobId: job.id,
              path: outside(pdfPath ?? texPath, MAXIMUM_PATH_CHARACTERS),
              texPath: outside(texPath, MAXIMUM_PATH_CHARACTERS),
              pdfPath: pdfPath === null ? null : outside(pdfPath, MAXIMUM_PATH_CHARACTERS),
              ...(pdfNote === undefined ? {} : { pdfNote }),
              pageFit: {
                estimatedLines: build.estimatedLines,
                lineLimit: build.lineLimit,
                estimateSaysOnePage: build.estimatedLines <= build.lineLimit,
                ...(pageCount === undefined
                  ? {}
                  : { pages: pageCount, compiledToOnePage: pageCount === 1 }),
              },
              pointsUsed: pointsOnPage(profile, build.texSource),
              keywordsUsed: build.matchedKeywords,
              keywordsRefused: build.notInProfile,
              ...(build.notInProfile.length === 0
                ? {}
                : {
                    keywordsRefusedReason:
                      "The profile does not support these keywords, so they were not added. Do not claim them anywhere else either.",
                  }),
              projectsShown: build.projectsShown,
              projectsLeftOut: build.projectsLeftOut,
              status: application.jobStore.get(job.id)?.status ?? job.status,
            },
            ["path", "texPath", "pdfPath"],
          );
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }),
  };
  return [buildResume];
}
