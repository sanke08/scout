/**
 * Likely interview rounds with practice questions, and questions the user can ask, by plain rules.
 *
 * Why: the plan must be useful with no model at all. Questions are built from the job's
 * requirements and the user's own resume points; they ask, they never claim.
 */
import type {
  CoreRequirement,
  InterviewJob,
  InterviewRound,
  InterviewStory,
} from "./interview-types.js";

/** The most requirements turned into technical questions. */
const TECHNICAL_QUESTION_COUNT = 4;

/** The most stories turned into deep-dive questions. */
const DEEP_DIVE_QUESTION_COUNT = 3;

/** The longest quoted resume line inside a question. */
const QUOTED_TEXT_LENGTH = 110;

/** Words in the job text that suggest a design or architecture round. */
const DESIGN_SIGNAL =
  /\b(system design|architecture|distributed|scalab\w*|microservices?|high availability|designing)\b/i;

/** Shortens a text for quoting inside a question, ending with "..." when cut. */
function shorten(text: string): string {
  return text.length <= QUOTED_TEXT_LENGTH ? text : `${text.slice(0, QUOTED_TEXT_LENGTH - 3)}...`;
}

/** One technical question for a requirement, depending on how well the user covers it. */
function technicalQuestion(requirement: CoreRequirement): string {
  switch (requirement.coverage) {
    case "on-resume":
      return `Tell me about a time you used ${requirement.term}. What did you build and what went wrong along the way?`;
    case "profile-only":
      return `${requirement.term} is not on the resume you sent. Where have you used it, and how deep does your experience go?`;
    case "gap":
      return `Have you used ${requirement.term}? (Use the honest answer prepared under the gaps.)`;
  }
}

/**
 * Builds the likely rounds: recruiter screen, technical screen, project deep dive, a system-design
 * round when the job text suggests one, and a behavioural round.
 * Questions come from the requirements (heaviest first), the stories and a fixed set of common
 * questions.
 */
export function buildRounds(
  job: InterviewJob,
  jobDescription: string,
  requirements: readonly CoreRequirement[],
  stories: readonly InterviewStory[],
): InterviewRound[] {
  const rounds: InterviewRound[] = [
    {
      name: "Recruiter screen",
      focus: "Fit, motivation, logistics and a short walk through your resume.",
      practiceQuestions: [
        "Walk me through your resume in two minutes.",
        `Why this ${job.title} role at ${job.company}?`,
        "What are you looking for in your next role?",
        "Where are you based, and when could you start?",
      ],
    },
    {
      name: "Technical screen",
      focus: "The job's heaviest requirements, one at a time.",
      practiceQuestions: requirements.slice(0, TECHNICAL_QUESTION_COUNT).map(technicalQuestion),
    },
    {
      name: "Project deep dive",
      focus: "The resume points you sent: the problem, the decision and what you would change.",
      practiceQuestions: stories
        .slice(0, DEEP_DIVE_QUESTION_COUNT)
        .map(
          (story) =>
            `Walk me through "${shorten(story.whatBuilt)}": what was the problem, what did you decide, and what would you change now?`,
        ),
    },
  ];
  if (DESIGN_SIGNAL.test(jobDescription)) {
    rounds.push({
      name: "System design",
      focus: "How you break a problem into parts, and what you trade away.",
      practiceQuestions: [
        "Pick a system you built. Draw it, then say where it would break first as load grows.",
        "How would you design a service that must keep working when one of its dependencies fails?",
        "Which part of your design would you change if the data became ten times bigger, and why?",
      ],
    });
  }
  rounds.push({
    name: "Behavioural and team",
    focus: "How you work with other people and handle mistakes.",
    practiceQuestions: [
      "Tell me about a disagreement with a teammate and how it ended.",
      "Tell me about a mistake you made in production or in a project, and what you changed after.",
      "How do you decide what to do first when everything is urgent?",
      "Tell me about something you learned quickly because a project needed it.",
    ],
  });
  return rounds.filter((round) => round.practiceQuestions.length > 0);
}

/**
 * Builds the questions the user can ask: a fixed set that fits any team, plus one about each of
 * the two heaviest requirements.
 */
export function buildQuestionsToAsk(requirements: readonly CoreRequirement[]): string[] {
  const questions = [
    "What does a good first three months look like in this role?",
    "How does the team review code and decide what to build next?",
    "What is the hardest technical problem the team is working on right now?",
    "How do you handle incidents, and what do you do afterwards?",
    "How are new people supported while they learn the codebase?",
    "What are the next steps, and when should I expect to hear back?",
  ];
  for (const requirement of requirements.slice(0, 2)) {
    questions.push(
      `How does the team use ${requirement.term} today, and what is hardest about it?`,
    );
  }
  return questions;
}
