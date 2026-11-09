/**
 * The checks every answer from the autopilot model must pass before Scout types it into a form.
 *
 * Why it exists: the model writes the answers the profile cannot supply, but the profile's facts
 * are the owner's, never the model's. A free-text answer that claims a skill, an employer, a
 * number, a year or a role the profile does not state is refused with the reason, using the same
 * claim check that guards resume wording. Anything on the owner's `neverUsed` list is refused too.
 *
 * Example: for a profile with Python and no Kafka, the answer "I ran Kafka at Initech for 5 years"
 * is refused ("The term "Kafka" is not backed ..."), while "Yes, I work with Python" is allowed.
 */
import type { AnswerRules } from "../../apply/index.js";
import { checkClaims } from "../../brain/index.js";
import {
  USABLE_POINT_STATUSES,
  type JobRecord,
  type Point,
  type Profile,
} from "../../shared/index.js";

/** Months in a year, to turn the profile's experience months into years the model may mention. */
const MONTHS_PER_YEAR = 12;

/** The terms the owner confirms are true: skills rows and the usable points' `allowed` lists. */
function allowedTermsOf(profile: Profile): string[] {
  const terms: string[] = [];
  for (const row of profile.skills) terms.push(...row.items);
  const addPoints = (points: Point[]): void => {
    for (const point of points) {
      if (USABLE_POINT_STATUSES.includes(point.status)) terms.push(...point.allowed);
    }
  };
  for (const entry of profile.experience) addPoints(entry.points);
  for (const project of profile.projects) addPoints(project.points);
  return terms;
}

/** The sentences and values the profile states about the owner. */
function knownFactsOf(profile: Profile, job: JobRecord): string[] {
  const facts: string[] = [];
  const { identity, education, preferences } = profile;
  facts.push(
    ...Object.values(identity).filter((value): value is string => typeof value === "string"),
  );
  facts.push(education.degree, education.dates, education.school, education.grade ?? "");
  facts.push(profile.summary.text);
  for (const entry of profile.experience) {
    facts.push(entry.title, entry.org, entry.dates, entry.place);
    for (const point of entry.points) {
      if (USABLE_POINT_STATUSES.includes(point.status)) facts.push(point.text);
    }
  }
  for (const project of profile.projects) {
    facts.push(project.title, project.stack);
    for (const point of project.points) {
      if (USABLE_POINT_STATUSES.includes(point.status)) facts.push(point.text);
    }
  }
  facts.push(
    ...preferences.targetRoles,
    ...preferences.locations,
    ...preferences.workAuthorization,
    ...preferences.seniority,
  );
  if (preferences.noticePeriodDays !== undefined) {
    facts.push(`${preferences.noticePeriodDays} days`, `${preferences.noticePeriodDays} day`);
  }
  const months = preferences.experienceMonths.fullTime + preferences.experienceMonths.internship;
  if (months > 0) {
    const years = months / MONTHS_PER_YEAR;
    facts.push(`${Math.floor(years)} years`, `${Math.round(years)} years`);
  }
  for (const entry of profile.answerBank) {
    if (/^\d{4}-\d{2}-\d{2}/.test(entry.approvedOn)) facts.push(entry.answer);
  }
  // The posting's own company, title and place are in the question; naming them claims nothing.
  facts.push(job.company, job.title, job.location);
  return facts.filter((fact) => fact.trim() !== "");
}

/** Builds the answer rules for one application. See the file comment. */
export function answerRulesFor(profile: Profile, job: JobRecord): AnswerRules {
  const support = { allowedTerms: allowedTermsOf(profile), knownFacts: knownFactsOf(profile, job) };
  return {
    neverUsed: profile.neverUsed,
    checkFreeText: (answer) => {
      const { unsupported } = checkClaims(answer, support);
      if (unsupported.length === 0) return undefined;
      const quoted = unsupported
        .slice(0, 5)
        .map((claim) => `"${claim.text}"`)
        .join(", ");
      return `The answer states things the owner's profile does not back (${quoted}), and Scout never invents facts about the owner. Remove them, or call flag_for_user so the owner answers this question.`;
    },
  };
}
