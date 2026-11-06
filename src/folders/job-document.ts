/**
 * The layout of a job's `job.md`: its front-matter fields and its fixed sections.
 *
 * Why it exists: the job folder manager, the board table and the tests must agree on one list of
 * field names and one list of section titles (one source of truth).
 *
 * Example: `renderNewJobDocument(...)` returns the whole text of a brand-new `job.md`; the
 * Job description section holds the posting text exactly as given.
 * Failure: functions here only build text and do not throw.
 */
import type { JobStatus } from "../shared/index.js";
import { renderFrontMatter, UNKNOWN_VALUE } from "./front-matter.js";
import { isoDate, logStamp } from "./time-format.js";

/** Front-matter keys of `job.md`, in the order they are written. */
export const JOB_FIELD_KEYS = [
  "job_id",
  "status",
  "company",
  "role",
  "location",
  "experience_asked",
  "link",
  "platform",
  "posted_by",
  "created",
  "applied",
  "resume_sent",
  "resume_tailored",
] as const;

/** One front-matter key of `job.md`, for example `"status"`. */
export type JobFieldKey = (typeof JOB_FIELD_KEYS)[number];

/** The section titles of `job.md`, in the order they appear. `Log` is always last. */
export const JOB_SECTION_TITLES = [
  "Job description",
  "Fit and gaps",
  "Resume selection",
  "Recruiter contact",
  "Outreach log",
  "Interview prep",
  "Log",
] as const;

/** One section title of `job.md`. */
export type JobSectionTitle = (typeof JOB_SECTION_TITLES)[number];

/** The values needed to write a new `job.md`. */
export interface NewJobDocument {
  jobId: string;
  status: JobStatus;
  company: string;
  role: string;
  location: string;
  experienceAsked: string;
  link: string;
  platform: string;
  postedBy: string;
  /** The posting text, saved word for word. */
  description: string;
  createdAt: Date;
}

/** Text shown under a section that has nothing in it yet, so nothing is left blank or guessed. */
const SECTION_PLACEHOLDERS: Record<Exclude<JobSectionTitle, "Job description" | "Log">, string> = {
  "Fit and gaps": "Not assessed yet.",
  "Resume selection": "Not chosen yet.",
  "Recruiter contact": UNKNOWN_VALUE,
  "Outreach log": "Nothing sent yet.",
  "Interview prep": "Not started.",
};

/** The first part of a section heading line, e.g. `## Fit and gaps`. */
export function sectionHeading(title: JobSectionTitle): string {
  return `## ${title}`;
}

/** The value written for a field, or `unknown` when it is empty. */
function valueOrUnknown(value: string): string {
  return value.trim() === "" ? UNKNOWN_VALUE : value;
}

/**
 * Builds the complete text of a new `job.md`.
 *
 * The description is placed exactly as received (not trimmed, not reflowed), because interview
 * preparation must never depend on a live page. An empty description is written as `unknown`.
 */
export function renderNewJobDocument(job: NewJobDocument): string {
  const frontMatter = renderFrontMatter({
    job_id: job.jobId,
    status: job.status,
    company: valueOrUnknown(job.company),
    role: valueOrUnknown(job.role),
    location: valueOrUnknown(job.location),
    experience_asked: valueOrUnknown(job.experienceAsked),
    link: valueOrUnknown(job.link),
    platform: valueOrUnknown(job.platform),
    posted_by: valueOrUnknown(job.postedBy),
    created: isoDate(job.createdAt),
    applied: UNKNOWN_VALUE,
    resume_sent: UNKNOWN_VALUE,
    resume_tailored: UNKNOWN_VALUE,
  });
  const description = job.description === "" ? UNKNOWN_VALUE : job.description;
  const parts = [
    frontMatter,
    "",
    `# ${valueOrUnknown(job.company)}: ${valueOrUnknown(job.role)}`,
    "",
    sectionHeading("Job description"),
    "",
    description.endsWith("\n") ? description : `${description}\n`,
  ];
  for (const title of JOB_SECTION_TITLES.slice(1, -1)) {
    parts.push(
      sectionHeading(title),
      "",
      SECTION_PLACEHOLDERS[title as keyof typeof SECTION_PLACEHOLDERS],
      "",
    );
  }
  parts.push(
    sectionHeading("Log"),
    "",
    `- ${logStamp(job.createdAt)}: Folder created with status ${job.status}.`,
    "",
  );
  return parts.join("\n");
}
