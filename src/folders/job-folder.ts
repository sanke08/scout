/**
 * Job folders: one folder per job, holding `job.md`, the resume files and the evidence.
 *
 * Why it exists: IDEA 5.11 wants every job touched to have a folder that survives on its own,
 * with the job description saved word for word the first time the job is touched, so interview
 * preparation never depends on a live page.
 *
 * Layout inside the jobs folder:
 *   2026-11-07_Acme_Backend-Engineer/
 *     job.md                  front matter, description, fit, log
 *     Alex_Rivera_Acme.tex    tailored resume source (saveTailoredResume)
 *     Alex_Rivera_Acme.pdf    tailored resume PDF (saveTailoredResume)
 *     sent/Alex_Rivera_Acme.pdf   the exact PDF sent at apply time (recordResumeSent)
 *
 * Example:
 *   const folders = createJobFolderManager({ jobsDirectory: jobsDirectory(), now: () => new Date() });
 *   const folder = folders.ensureJobFolder(posting);   // { name, path, created }
 *   folders.setStatus(folder.name, "shortlisted", "score 82");
 * Failure: unsafe names throw `ScoutError("unsafe")`, unknown folders `ScoutError("not-found")`,
 * bad values `ScoutError("invalid-input")`. Writes are atomic. One process at a time is assumed:
 * two processes updating the same `job.md` at once could lose one change.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ScoutError, isJobStatus } from "../shared/index.js";
import type { JobRecord, JobStatus, Posting } from "../shared/index.js";
import { copyFileAtomic, writeTextAtomic } from "./atomic-file.js";
import { parseFrontMatter, patchFrontMatter, UNKNOWN_VALUE } from "./front-matter.js";
import type { ParsedFrontMatter } from "./front-matter.js";
import { JOB_SECTION_TITLES, renderNewJobDocument, sectionHeading } from "./job-document.js";
import type { JobFieldKey, JobSectionTitle } from "./job-document.js";
import { camelCaseCompany, comparisonKey, letterSuffix, makeFolderName } from "./naming.js";
import { assertSafeName, resolveInside } from "./safe-path.js";
import { isoDate, logStamp } from "./time-format.js";

/** The file inside each job folder that holds the record of the job. */
export const JOB_FILE_NAME = "job.md";

/** The folder inside a job folder that holds the exact PDF sent. */
export const SENT_FOLDER_NAME = "sent";

/** Settings for the manager. `now` is injected so tests are deterministic. */
export interface JobFolderManagerOptions {
  /** The folder that holds all job folders, for example `jobsDirectory()`. */
  jobsDirectory: string;
  now: () => Date;
}

/** Optional facts that the posting itself does not carry. */
export interface EnsureJobFolderOptions {
  /** Used as the ending of the folder name when another folder already has the same name. */
  recruiterName?: string;
  /** Experience the posting asks for, as written, for example "3+ years". */
  experienceAsked?: string;
  /** Who posted the job (a person or a company), for the `posted_by` field. */
  postedBy?: string;
}

/** The folder returned by `ensureJobFolder`. */
export interface JobFolder {
  /** The folder name, for example `2026-11-07_Acme_Backend-Engineer`. Never changes. */
  name: string;
  /** The absolute path of the folder. */
  path: string;
  /** True when this call made the folder; false when an existing one was reused. */
  created: boolean;
}

/** The tailored resume to save in a job folder. */
export interface TailoredResume {
  /** File name without extension, such as `Alex_Rivera_ExampleCorp`. */
  fileStem: string;
  /** The complete LaTeX source. */
  texSource: string;
  /** Path of a compiled PDF to copy in, if one was built. */
  pdfPath?: string;
}

/** What the manager can do. See the file comment for an example. */
export interface JobFolderManager {
  /** Finds or creates the folder for a posting or stored job; never touches an existing job.md. */
  ensureJobFolder(job: Posting | JobRecord, options?: EnsureJobFolderOptions): JobFolder;
  /** Returns the name of the existing folder for this job, or `undefined`. */
  findJobFolder(job: Posting | JobRecord): string | undefined;
  /** Reads the front matter and body of a folder's `job.md`. */
  readJob(folderName: string): ParsedFrontMatter;
  /** Changes front-matter fields of `job.md`. Values are single lines; empty becomes `unknown`. */
  updateFrontMatter(folderName: string, patch: Partial<Record<JobFieldKey, string>>): void;
  /** Sets the status, stamps `applied` the first time the status is `applied`, and logs it. */
  setStatus(folderName: string, status: JobStatus, reason: string): void;
  /** Adds one dated line at the end of the Log section. */
  appendLogLine(folderName: string, text: string): void;
  /** Replaces the text of one section other than Job description and Log. */
  writeSection(folderName: string, title: JobSectionTitle, text: string): void;
  /** Saves `Name_Company.tex` (and `.pdf`) and records `resume_tailored`. Returns the file names. */
  saveTailoredResume(folderName: string, resume: TailoredResume): string[];
  /** Copies the exact PDF sent into `sent/`, keeping its file name, and records `resume_sent`. */
  recordResumeSent(folderName: string, pdfPath: string): string;
}

/** The letters allowed in a resume file stem. */
const RESUME_STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Returns true when the job argument already carries a status (it is a stored `JobRecord`). */
function isJobRecord(job: Posting | JobRecord): job is JobRecord {
  return "status" in job && isJobStatus((job as JobRecord).status);
}

/** Makes the folder name safe to put after a hyphen: CamelCase, or empty if nothing usable. */
function recruiterEnding(recruiterName: string | undefined): string {
  if (recruiterName === undefined) {
    return "";
  }
  const camel = camelCaseCompany(recruiterName);
  return camel === "Unknown" ? "" : camel;
}

/**
 * Creates the manager for one jobs folder.
 * Failure: none until a method is called; the jobs folder is created on first use.
 */
export function createJobFolderManager(options: JobFolderManagerOptions): JobFolderManager {
  const { jobsDirectory, now } = options;

  /** Absolute path of a folder, proven to be directly inside the jobs folder. */
  function folderPath(folderName: string): string {
    return resolveInside(jobsDirectory, folderName, "job folder name");
  }

  /** Path of `job.md` in a folder; throws `not-found` when the folder has none. */
  function jobFilePath(folderName: string): string {
    const path = join(folderPath(folderName), JOB_FILE_NAME);
    if (!existsSync(path)) {
      throw new ScoutError(
        "not-found",
        `There is no ${JOB_FILE_NAME} in the job folder "${folderName}". Check the folder name or create the folder first.`,
      );
    }
    return path;
  }

  /** The names of all folders in the jobs folder that have a readable `job.md`, with fields. */
  function existingJobs(): { name: string; fields: Record<string, string> }[] {
    if (!existsSync(jobsDirectory)) {
      return [];
    }
    const found: { name: string; fields: Record<string, string> }[] = [];
    for (const entry of readdirSync(jobsDirectory).sort()) {
      const file = join(jobsDirectory, entry, JOB_FILE_NAME);
      if (entry.startsWith(".") || !existsSync(file)) {
        continue;
      }
      const parsed = parseFrontMatter(readFileSync(file, "utf8"));
      if (parsed !== undefined) {
        found.push({ name: entry, fields: parsed.fields });
      }
    }
    return found;
  }

  function findJobFolder(job: Posting | JobRecord): string | undefined {
    const candidates = existingJobs();
    const sameJob = candidates.find(
      (candidate) =>
        candidate.fields["job_id"] === job.id ||
        (job.canonicalUrl !== "" && candidate.fields["link"] === job.canonicalUrl),
    );
    if (sameJob !== undefined) {
      return sameJob.name;
    }
    const wantedKey = `${comparisonKey(job.company)}|${comparisonKey(job.title)}`;
    const sameRole = candidates.find((candidate) => {
      const candidateKey = `${comparisonKey(candidate.fields["company"] ?? "")}|${comparisonKey(candidate.fields["role"] ?? "")}`;
      const candidateHasNoLink = (candidate.fields["link"] ?? UNKNOWN_VALUE) === UNKNOWN_VALUE;
      return candidateKey === wantedKey && (candidateHasNoLink || job.canonicalUrl === "");
    });
    return sameRole?.name;
  }

  /** Makes a new empty folder, trying `-Recruiter`, then `-A`, `-B`, ... when the name is taken. */
  function createUniqueFolder(baseName: string, recruiterName: string | undefined): string {
    mkdirSync(jobsDirectory, { recursive: true });
    const candidates = [baseName];
    const recruiter = recruiterEnding(recruiterName);
    if (recruiter !== "") {
      candidates.push(`${baseName}-${recruiter}`);
    }
    for (let index = 0; ; index += 1) {
      const name = candidates[index] ?? `${baseName}-${letterSuffix(index - candidates.length)}`;
      try {
        mkdirSync(folderPath(name));
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
    }
  }

  function ensureJobFolder(
    job: Posting | JobRecord,
    extra: EnsureJobFolderOptions = {},
  ): JobFolder {
    const existing = findJobFolder(job);
    if (existing !== undefined) {
      return { name: existing, path: folderPath(existing), created: false };
    }
    const createdAt = now();
    const name = createUniqueFolder(
      makeFolderName(createdAt, job.company, job.title),
      extra.recruiterName,
    );
    const status: JobStatus = isJobRecord(job) ? job.status : "found";
    writeTextAtomic(
      join(folderPath(name), JOB_FILE_NAME),
      renderNewJobDocument({
        jobId: job.id,
        status,
        company: job.company,
        role: job.title,
        location: job.location,
        experienceAsked: extra.experienceAsked ?? UNKNOWN_VALUE,
        link: job.canonicalUrl,
        platform: job.board,
        postedBy: extra.postedBy ?? UNKNOWN_VALUE,
        description: job.description,
        createdAt,
      }),
    );
    return { name, path: folderPath(name), created: true };
  }

  function readJob(folderName: string): ParsedFrontMatter {
    const parsed = parseFrontMatter(readFileSync(jobFilePath(folderName), "utf8"));
    if (parsed === undefined) {
      throw new ScoutError(
        "invalid-input",
        `The ${JOB_FILE_NAME} in "${folderName}" has no front-matter block between two --- lines. Restore the block or remove the file.`,
      );
    }
    return parsed;
  }

  function updateFrontMatter(
    folderName: string,
    patch: Partial<Record<JobFieldKey, string>>,
  ): void {
    const file = jobFilePath(folderName);
    const cleanPatch: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        cleanPatch[key] = value;
      }
    }
    if (cleanPatch["status"] !== undefined && !isJobStatus(cleanPatch["status"])) {
      throw new ScoutError(
        "invalid-input",
        `"${cleanPatch["status"]}" is not a job status, so the front matter was not changed.`,
      );
    }
    writeTextAtomic(file, patchFrontMatter(readFileSync(file, "utf8"), cleanPatch));
  }

  function appendLogLine(folderName: string, text: string): void {
    const file = jobFilePath(folderName);
    const current = readFileSync(file, "utf8");
    const line = `- ${logStamp(now())}: ${text.replace(/\s*[\r\n]+\s*/g, " ").trim()}\n`;
    writeTextAtomic(file, current.endsWith("\n") ? current + line : `${current}\n${line}`);
  }

  function setStatus(folderName: string, status: JobStatus, reason: string): void {
    const fields = readJob(folderName).fields;
    const patch: Partial<Record<JobFieldKey, string>> = { status };
    if (status === "applied" && (fields["applied"] ?? UNKNOWN_VALUE) === UNKNOWN_VALUE) {
      patch.applied = isoDate(now());
    }
    updateFrontMatter(folderName, patch);
    appendLogLine(folderName, `Status is now ${status}: ${reason}`);
  }

  function writeSection(folderName: string, title: JobSectionTitle, text: string): void {
    if (title === "Job description" || title === "Log") {
      throw new ScoutError(
        "invalid-input",
        `The ${title} section is never rewritten. Use appendLogLine for the log; the job description is saved once and kept.`,
      );
    }
    const headings = JOB_SECTION_TITLES.map((sectionTitle) => sectionHeading(sectionTitle));
    if (text.split(/\r?\n/).some((line) => headings.includes(line.trimEnd()))) {
      throw new ScoutError(
        "invalid-input",
        "The text contains a line that looks like one of the job.md section headings, which would break the file. Rephrase that line.",
      );
    }
    const file = jobFilePath(folderName);
    const lines = readFileSync(file, "utf8").split("\n");
    const titleIndex = JOB_SECTION_TITLES.indexOf(title);
    const startIndex = lines.lastIndexOf(sectionHeading(title));
    const nextHeading = sectionHeading(JOB_SECTION_TITLES[titleIndex + 1] ?? "Log");
    const endIndex = lines.indexOf(nextHeading, startIndex + 1);
    if (startIndex < 0 || endIndex < 0) {
      throw new ScoutError(
        "invalid-input",
        `The ${JOB_FILE_NAME} in "${folderName}" is missing the "${title}" section or the one after it, so it was not changed.`,
      );
    }
    const body = text.trim() === "" ? UNKNOWN_VALUE : text.replace(/\s+$/, "");
    const rewritten = [...lines.slice(0, startIndex + 1), "", body, "", ...lines.slice(endIndex)];
    writeTextAtomic(file, rewritten.join("\n"));
  }

  function saveTailoredResume(folderName: string, resume: TailoredResume): string[] {
    if (!RESUME_STEM_PATTERN.test(resume.fileStem)) {
      throw new ScoutError(
        "unsafe",
        `The resume file name "${resume.fileStem.slice(0, 60)}" may only contain letters, digits, underscores and hyphens, so Scout refused to save it.`,
      );
    }
    jobFilePath(folderName);
    const folder = folderPath(folderName);
    const saved = [`${resume.fileStem}.tex`];
    writeTextAtomic(join(folder, saved[0] as string), resume.texSource);
    if (resume.pdfPath !== undefined) {
      copyFileAtomic(resume.pdfPath, join(folder, `${resume.fileStem}.pdf`));
      saved.push(`${resume.fileStem}.pdf`);
    }
    updateFrontMatter(folderName, { resume_tailored: saved[saved.length - 1] as string });
    appendLogLine(folderName, `Saved tailored resume ${saved.join(" and ")}.`);
    return saved;
  }

  function recordResumeSent(folderName: string, pdfPath: string): string {
    const fileName = assertSafeName(basename(pdfPath), "resume file name");
    if (
      !fileName.toLowerCase().endsWith(".pdf") ||
      !existsSync(pdfPath) ||
      !statSync(pdfPath).isFile()
    ) {
      throw new ScoutError(
        "invalid-input",
        `The resume that was sent must be an existing PDF file, but "${fileName}" is not one.`,
      );
    }
    jobFilePath(folderName);
    const sentFolder = join(folderPath(folderName), SENT_FOLDER_NAME);
    mkdirSync(sentFolder, { recursive: true });
    copyFileAtomic(pdfPath, join(sentFolder, fileName));
    const recorded = `${SENT_FOLDER_NAME}/${fileName}`;
    updateFrontMatter(folderName, { resume_sent: recorded });
    appendLogLine(folderName, `Copied the exact resume sent: ${recorded}.`);
    return recorded;
  }

  return {
    ensureJobFolder,
    findJobFolder,
    readJob,
    updateFrontMatter,
    setStatus,
    appendLogLine,
    writeSection,
    saveTailoredResume,
    recordResumeSent,
  };
}
