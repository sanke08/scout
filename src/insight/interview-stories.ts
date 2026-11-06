/**
 * Picks the stories the user can tell, drawn only from the resume points that were sent.
 *
 * Why: the recruiter has the resume that was sent. A story from anywhere else (a point left out,
 * a profile line never sent) would be one the interviewer has never seen and may not be backed.
 * Each story repeats the sent wording unchanged and asks the user for the problem and the decision
 * from memory; Scout does not know them and does not make them up.
 */
import type { Profile } from "../shared/index.js";
import type { FoundRequirement } from "./requirements.js";
import type { InterviewStory, ResumePointSent } from "./interview-types.js";
import { containsTerm } from "./text-match.js";

/** The most stories in a plan. */
export const MAXIMUM_STORIES = 6;

/** The question that asks the user for the problem behind a point. */
const PROBLEM_PROMPT =
  "What problem was this solving, and for whom? The resume line says what you built, not why: answer from your own memory.";

/** The question that asks the user for the decision behind a point. */
const DECISION_PROMPT =
  "What did you decide, what else did you consider, and why did you choose this? Answer from your own memory.";

/**
 * The allowed terms of the profile point whose text, or one of whose alternate wordings, equals
 * the text that was sent. Empty when the sent text is not a profile point (for example edited by
 * hand afterwards).
 */
function allowedTermsOfSentPoint(profile: Profile, sentText: string): string[] {
  for (const entry of [...profile.experience, ...profile.projects]) {
    for (const point of entry.points) {
      if (point.text === sentText || point.variants.some((variant) => variant.text === sentText)) {
        return point.allowed;
      }
    }
  }
  return [];
}

/**
 * The reason a point gives for itself, if it has one: the words after "so", "so that" or
 * "because" (at least three words). Example: "Replaced polling with live updates, so a room that
 * sells out disappears within seconds." gives "a room that sells out disappears within seconds".
 */
function statedReasonOf(text: string): string | undefined {
  const match = /\b(?:so that|so|because)\s+(.+?)\.?$/i.exec(text.trim());
  const reason = match?.[1]?.trim();
  return reason !== undefined && reason.split(/\s+/).length >= 3 ? reason : undefined;
}

/** True when the sent point shows the requirement in its words or in its profile point's terms. */
export function pointShowsRequirement(
  point: ResumePointSent,
  profile: Profile,
  requirementTerm: string,
): boolean {
  return (
    containsTerm(point.text, requirementTerm) ||
    allowedTermsOfSentPoint(profile, point.text).some(
      (term) => term.trim().toLowerCase() === requirementTerm.toLowerCase(),
    )
  );
}

/**
 * Builds up to `MAXIMUM_STORIES` stories, best first. A point becomes a story when it shows at
 * least one core requirement; stories are ordered by the total weight of the requirements they
 * show, ties by their order on the resume.
 *
 * Example: a sent point "Replaced polling with WebSockets ..." for a job asking for WebSockets
 * becomes a story whose `matchedRequirements` is `["WebSockets"]`.
 */
export function buildStories(
  resumeSent: readonly ResumePointSent[],
  requirements: readonly FoundRequirement[],
  profile: Profile,
): InterviewStory[] {
  const ranked = resumeSent.map((point, position) => {
    const shown = requirements.filter((requirement) =>
      pointShowsRequirement(point, profile, requirement.term),
    );
    const total = shown.reduce((sum, requirement) => sum + requirement.weight, 0);
    return { point, position, shown, total };
  });
  return ranked
    .filter((candidate) => candidate.shown.length > 0)
    .sort((left, right) => right.total - left.total || left.position - right.position)
    .slice(0, MAXIMUM_STORIES)
    .map(({ point, shown }) => {
      const story: InterviewStory = {
        heading: point.heading,
        section: point.section,
        whatBuilt: point.text,
        problemPrompt: PROBLEM_PROMPT,
        decisionPrompt: DECISION_PROMPT,
        matchedRequirements: shown.map((requirement) => requirement.term),
      };
      const reason = statedReasonOf(point.text);
      if (reason !== undefined) {
        story.statedReason = reason;
      }
      return story;
    });
}
