/**
 * Renders an interview plan as Markdown for the user to read and keep in the job folder.
 *
 * Why: the plan is typed data first; the text is a view of it. Text that came from outside (the
 * company and title) is cleaned to one line so it cannot add headings of its own.
 */
import type { InterviewPlan } from "./interview-types.js";
import { toOneLine } from "./text-match.js";

/** Renders `plan` as Markdown: requirements, stories, gaps, rounds and questions to ask. */
export function renderInterviewPlan(plan: InterviewPlan): string {
  const lines: string[] = [
    `# Interview plan: ${toOneLine(plan.title)} at ${toOneLine(plan.company)}`,
    "",
  ];
  if (!plan.modelUsed) {
    lines.push(
      `Rules-only plan: ${plan.degradedReason ?? "no model was used"}. Everything below comes from the job text, your profile and the resume you sent.`,
      "",
    );
  }

  lines.push("## Core requirements", "");
  if (plan.requirements.length === 0) {
    lines.push("No known requirements were found in the job text.");
  }
  for (const requirement of plan.requirements) {
    lines.push(
      `- ${requirement.term} (weight ${requirement.weight}, ${requirement.importance}): ${requirement.coverage}`,
    );
  }

  lines.push("", "## Your stories (from the resume you sent)", "");
  if (plan.stories.length === 0) {
    lines.push("No resume point sent shows a core requirement.");
  }
  for (const story of plan.stories) {
    lines.push(
      `### ${toOneLine(story.heading)}`,
      "",
      `- What you built (as sent): ${toOneLine(story.whatBuilt)}`,
    );
    if (story.statedReason !== undefined) {
      lines.push(`- Reason the resume gives: ${toOneLine(story.statedReason)}`);
    }
    lines.push(
      `- Problem: ${story.problemPrompt}`,
      `- Decision: ${story.decisionPrompt}`,
      `- Speaks to: ${story.matchedRequirements.join(", ")}`,
      "",
    );
  }

  lines.push("## Gaps and honest answers", "");
  if (plan.gaps.length === 0) {
    lines.push("Every core requirement is in your profile.");
  }
  for (const gap of plan.gaps) {
    lines.push(`- ${gap.term} (${gap.importance}): "${gap.honestAnswer}"`);
  }

  lines.push("", "## Likely rounds and practice questions", "");
  for (const round of plan.rounds) {
    lines.push(`### ${round.name}`, "", round.focus, "");
    for (const question of round.practiceQuestions) {
      lines.push(`- ${question}`);
    }
    lines.push("");
  }
  if (plan.extraPracticeQuestions.length > 0) {
    lines.push("### More practice questions (written by the model)", "");
    for (const question of plan.extraPracticeQuestions) {
      lines.push(`- ${toOneLine(question)}`);
    }
    lines.push("");
  }

  lines.push("## Questions you can ask", "");
  for (const question of plan.questionsToAsk) {
    lines.push(`- ${question}`);
  }
  lines.push("");
  return lines.join("\n");
}
