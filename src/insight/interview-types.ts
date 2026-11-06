/**
 * The shapes of an interview plan: its inputs and the typed object it produces.
 *
 * Why: the plan is shown as Markdown to the user and also read by other code (the web page, the
 * job folder), so it exists first as plain typed data and is rendered second.
 */

/**
 * The job the plan is for. `skills` are the skills the posting names, as written; they are
 * outside text, so they are only used to look for requirements, never to describe the user.
 */
export interface InterviewJob {
  company: string;
  title: string;
  skills?: string[];
}

/**
 * One resume point exactly as it was sent to the recruiter.
 * - `section`: where it sat on the resume.
 * - `heading`: the employer or project name above it.
 * - `text`: the words that were sent (the approved wording actually used).
 */
export interface ResumePointSent {
  section: "experience" | "projects";
  heading: string;
  text: string;
}

/** How the job text treats a requirement: asked for firmly, wished for, or just mentioned. */
export type RequirementImportance = "required" | "preferred" | "mentioned";

/**
 * How well the user can answer for a requirement.
 * - `on-resume`: a resume point sent shows it.
 * - `profile-only`: the profile has it but the resume sent does not show it.
 * - `gap`: the profile does not have it at all.
 */
export type RequirementCoverage = "on-resume" | "profile-only" | "gap";

/** One core requirement of the job, with its weight (higher matters more) and coverage. */
export interface CoreRequirement {
  term: string;
  weight: number;
  importance: RequirementImportance;
  coverage: RequirementCoverage;
}

/**
 * One story the user can tell, taken only from a resume point that was sent.
 * - `whatBuilt`: the resume point's own words, unchanged.
 * - `statedReason`: the reason the point itself gives ("so a room that sells out disappears..."),
 *   when it gives one.
 * - `problemPrompt` and `decisionPrompt`: questions for the user to answer from memory; Scout does
 *   not know the problem or the decision and does not invent them.
 * - `matchedRequirements`: the job requirements this story speaks to.
 */
export interface InterviewStory {
  heading: string;
  section: "experience" | "projects";
  whatBuilt: string;
  statedReason?: string;
  problemPrompt: string;
  decisionPrompt: string;
  matchedRequirements: string[];
}

/**
 * A requirement the profile does not cover, with an honest way to answer.
 * - `honestAnswer`: a sentence that uses only the gap term itself and terms from the profile.
 * - `relatedTerms`: the profile terms of the same family used in the answer; may be empty.
 */
export interface InterviewGap {
  term: string;
  importance: RequirementImportance;
  honestAnswer: string;
  relatedTerms: string[];
}

/** One likely interview round with its focus and practice questions. */
export interface InterviewRound {
  name: string;
  focus: string;
  practiceQuestions: string[];
}

/**
 * The whole plan.
 * - `extraPracticeQuestions`: questions added by the model, empty when no model was used.
 * - `modelUsed`: true when the model's questions are included.
 * - `degradedReason`: why the model's part is missing (no model supplied, or the failure message).
 */
export interface InterviewPlan {
  company: string;
  title: string;
  requirements: CoreRequirement[];
  stories: InterviewStory[];
  gaps: InterviewGap[];
  rounds: InterviewRound[];
  questionsToAsk: string[];
  extraPracticeQuestions: string[];
  modelUsed: boolean;
  degradedReason?: string;
}
