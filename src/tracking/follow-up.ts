/**
 * Writes follow-up drafts for applications that have had no reply.
 *
 * Why it exists: after a set number of quiet days a short, polite nudge often gets an answer, but
 * writing it each time is tedious. Scout writes the draft; the user reads it, edits it and sends
 * it. Scout never sends anything.
 *
 * Every fact in a draft comes from the profile (and the job's own title and company). Nothing is
 * invented: no skills, no numbers, no links that are not in the profile.
 *
 * Example: `draftFollowUp(job, profile, settings, now)` for a job that has been `applied` for 9
 * days (limit 7) returns `{ jobId, subject, emailBody, connectionNote, sent: false }`.
 */
import type {
  ExperienceEntry,
  JobRecord,
  Profile,
  ProjectEntry,
  Settings,
} from "../shared/index.js";
import { USABLE_POINT_STATUSES } from "../shared/index.js";

/** A follow-up the user can review. `sent` is always false: Scout does not send mail. */
export interface FollowUpDraft {
  jobId: string;
  /** Email subject. Example: "Following up on my application: Backend Engineer". */
  subject: string;
  /** Email body, about 150 words, ending with the user's name. */
  emailBody: string;
  /** A short note for a connection request, under 300 characters. */
  connectionNote: string;
  /** Always false. A draft is text for the user; sending is the user's own action. */
  sent: false;
  /** How many days the application has been without a reply. */
  daysWithoutReply: number;
}

/** A connection note must stay under this many characters. */
export const CONNECTION_NOTE_LIMIT = 300;

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days since the job became `applied`, or undefined when it is not `applied`.
 *
 * `appliedAt` (an ISO time, for example from the action log) is the exact moment it was applied.
 * Without it, the job's `updatedAt` is used. That is the moment of the last change to the job,
 * which is the apply moment unless the posting was seen again since (the store also updates
 * `updatedAt` then), so pass `appliedAt` when the log is at hand.
 */
export function daysWithoutReply(
  job: JobRecord,
  now: Date,
  appliedAt?: string,
): number | undefined {
  if (job.status !== "applied") return undefined;
  const since = Date.parse(appliedAt ?? job.updatedAt);
  if (Number.isNaN(since)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
}

/** True when the job is `applied` and has waited at least `settings.followUpAfterDays` days. */
export function isFollowUpDue(
  job: JobRecord,
  settings: Settings,
  now: Date,
  appliedAt?: string,
): boolean {
  const days = daysWithoutReply(job, now, appliedAt);
  return days !== undefined && days >= settings.followUpAfterDays;
}

/** Removes a trailing full stop and lower-cases the first letter, so a point reads inside a sentence. */
function asClause(sentence: string): string {
  const trimmed = sentence.trim().replace(/[.!]+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The first point of the first experience entry that the user lets Scout use, or undefined. */
function firstUsableExperiencePoint(entry: ExperienceEntry): string | undefined {
  return entry.points.find((point) => USABLE_POINT_STATUSES.includes(point.status))?.text;
}

/** The project to mention: the first with a link, else the first project at all. */
function chooseProject(projects: ProjectEntry[]): ProjectEntry | undefined {
  return projects.find((project) => (project.link ?? project.live) !== undefined) ?? projects[0];
}

/** Cuts `text` to at most `limit` characters at a word boundary, adding nothing else. */
function clampAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** The sentence about where the user works and what they build, from the first experience entry. */
function workSentence(entry: ExperienceEntry | undefined): string | undefined {
  if (entry === undefined) return undefined;
  const point = firstUsableExperiencePoint(entry);
  const base = `I work as a ${entry.title} at ${entry.org}`;
  return point === undefined ? `${base}.` : `${base}, where I ${asClause(point)}.`;
}

/** The line about personal projects with one link, or undefined when the profile has no project. */
function projectLine(project: ProjectEntry | undefined): string | undefined {
  if (project === undefined) return undefined;
  const link = project.link ?? project.live;
  const base = `Outside work I build personal projects, such as ${project.title} (${project.stack})`;
  return link === undefined ? `${base}.` : `${base}: ${link}`;
}

/** The availability sentence from the notice period, or undefined when the profile has none. */
function availabilityLine(noticePeriodDays: number | undefined): string | undefined {
  if (noticePeriodDays === undefined) return undefined;
  return noticePeriodDays === 0
    ? "I can start immediately."
    : `My notice period is ${noticePeriodDays} days.`;
}

/**
 * Returns a follow-up draft, or undefined when no follow-up is due (the job is not `applied`, or
 * it has waited fewer than `settings.followUpAfterDays` days).
 *
 * The email follows the set format: where the user works and what they build (the profile's
 * first experience entry), one line on personal projects with one link, availability from the
 * notice period, "resume attached", a sign-off. The connection note is under 300 characters.
 */
export function draftFollowUp(
  job: JobRecord,
  profile: Profile,
  settings: Settings,
  now: Date,
  appliedAt?: string,
): FollowUpDraft | undefined {
  const days = daysWithoutReply(job, now, appliedAt);
  if (days === undefined || days < settings.followUpAfterDays) return undefined;

  const experience = profile.experience[0];
  const project = chooseProject(profile.projects);
  const paragraphs: string[] = [
    "Hello,",
    `I applied for the ${job.title} role at ${job.company} ${days} days ago and wanted to follow up on it. I am still very interested.`,
    [workSentence(experience), projectLine(project)].filter((line) => line !== undefined).join(" "),
    [availabilityLine(profile.preferences.noticePeriodDays), "My resume is attached."]
      .filter((line) => line !== undefined)
      .join(" "),
    `Thank you for your time.\n\nBest regards,\n${profile.identity.name}`,
  ];
  const emailBody = paragraphs.filter((paragraph) => paragraph !== "").join("\n\n");

  const noteParts = [
    `Hi, I applied for the ${job.title} role at ${job.company} and would love to connect.`,
    experience === undefined ? undefined : `I work as a ${experience.title} at ${experience.org}.`,
    `${profile.identity.name}`,
  ];
  const connectionNote = clampAtWord(
    noteParts.filter((part) => part !== undefined).join(" "),
    CONNECTION_NOTE_LIMIT - 1,
  );

  return {
    jobId: job.id,
    subject: `Following up on my application: ${job.title}`,
    emailBody,
    connectionNote,
    sent: false,
    daysWithoutReply: days,
  };
}
