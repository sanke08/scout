/**
 * Public surface of the insight module: reading the user's own projects once, and interview
 * preparation. Other modules import only from here (or from `src/shared`).
 *
 * Typical use: `readRepository(folder)` gives a bounded digest; `writeProjectNote(brain, digest,
 * { notesDirectory })` writes one verified note; `draftProfileFromNotes(loadProjectNotes(dir))`
 * drafts hold-status points for review; `buildInterviewPlan({...})` prepares for an interview.
 */
export { readRepository } from "./repository-reader.js";
export {
  DEFAULT_REPOSITORY_LIMITS,
  type DigestFile,
  type LimitName,
  type RepositoryDigest,
  type RepositoryLimits,
  type SkipReason,
  type SkippedEntry,
} from "./repository-types.js";
export {
  noteFileName,
  writeProjectNote,
  type WriteProjectNoteOptions,
  type WriteProjectNoteResult,
} from "./note-writer.js";
export {
  projectNoteReplySchema,
  PROJECT_VERDICTS,
  FEATURE_STATUSES,
  type ProjectNoteReply,
} from "./note-schema.js";
export { verifyNote, type VerifiedNote } from "./note-verification.js";
export { draftProfileFromNotes, type DraftProject } from "./draft-profile.js";
export {
  authoredByUser,
  parseCommitLine,
  type CommitRecord,
  type UserIdentity,
} from "./authored-commits.js";
export {
  buildInterviewPlan,
  type InterviewPlanInput,
  type InterviewPlanResult,
} from "./interview-plan.js";
export { renderInterviewPlan } from "./interview-render.js";
export type {
  CoreRequirement,
  InterviewGap,
  InterviewJob,
  InterviewPlan,
  InterviewRound,
  InterviewStory,
  RequirementCoverage,
  RequirementImportance,
  ResumePointSent,
} from "./interview-types.js";
