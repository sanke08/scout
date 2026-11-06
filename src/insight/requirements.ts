/**
 * Finds a job's core requirements by plain rules, with no model.
 *
 * Why: interview preparation starts from "what does this job care about most?". Weight comes from
 * how often a technology is mentioned and from words such as "required" and "must", so the answer
 * is the same every time for the same text and can be checked.
 *
 * What counts as a requirement: a technology name from the known list, from the posting's own
 * skills list, or from the user's profile that appears in the job text. A requirement is a thing
 * the job asks for; it is never evidence that the user has it.
 */
import { containsTerm, countTerm } from "./text-match.js";
import { KNOWN_TECHNOLOGIES } from "./technology-vocabulary.js";
import type { RequirementImportance } from "./interview-types.js";

/** A requirement before coverage is known. */
export interface FoundRequirement {
  term: string;
  weight: number;
  importance: RequirementImportance;
}

/** How many requirements the plan keeps. */
export const MAXIMUM_REQUIREMENTS = 12;

/** Terms this short are only taken from the posting's skills list, never from running text. */
const SHORT_TERM_LENGTH = 2;

/** Weight added for every mention in a sentence that asks firmly. */
const REQUIRED_MENTION_BONUS = 3;

/** Weight of one mention in a "nice to have" sentence (a plain mention weighs 1). */
const PREFERRED_MENTION_WEIGHT = 0.5;

/** Weight added when the term is in the job title. */
const TITLE_BONUS = 2;

/** Weight added when the posting lists the term in its skills list. */
const LISTED_SKILL_BONUS = 2;

/** Phrases that say a thing is asked for firmly. */
const REQUIRED_PHRASES =
  /\b(required|requirements?|must|essential|needed|need to|minimum|proficien\w+|strong|solid|expert\w*|hands-on|years? of)\b/i;

/** Phrases that say a thing is only wished for. */
const PREFERRED_PHRASES =
  /\b(nice to have|preferred|bonus|a plus|is a plus|ideally|desirable|familiarity|exposure)\b/i;

/** Short heading lines that start a firm-requirements part of a posting. */
const REQUIRED_HEADING = /^(requirements?|what you.ll need|must[- ]have|qualifications|you have)/i;

/** Short heading lines that start a wished-for part of a posting. */
const PREFERRED_HEADING = /^(nice[- ]to[- ]have|bonus|preferred|a plus)/i;

/** Short heading lines that start a part about something else (duties, benefits, the company). */
const NEUTRAL_HEADING =
  /^(responsibilities|what you.ll do|about|benefits|perks|we offer|who we are|the role|how we work)/i;

/** One sentence of the job text with the kind of part of the posting it sits in. */
interface Sentence {
  text: string;
  kind: RequirementImportance;
}

/**
 * Splits job text into sentences and tags each as required, preferred or mentioned, using its own
 * words first and the heading above it second.
 * Example: under a "Requirements:" heading, the line "Node.js" is `required`.
 */
function splitSentences(jobText: string): Sentence[] {
  const sentences: Sentence[] = [];
  let sectionKind: RequirementImportance = "mentioned";
  for (const line of jobText.split(/\n|•/)) {
    const trimmed = line.trim().replace(/^[-*\d.)\s]+/, "");
    if (trimmed === "") {
      continue;
    }
    if (trimmed.length <= 60) {
      if (PREFERRED_HEADING.test(trimmed)) {
        sectionKind = "preferred";
      } else if (REQUIRED_HEADING.test(trimmed)) {
        sectionKind = "required";
      } else if (NEUTRAL_HEADING.test(trimmed)) {
        sectionKind = "mentioned";
      }
    }
    for (const piece of trimmed.split(/(?<=[.!?])\s+/)) {
      let kind = sectionKind;
      if (PREFERRED_PHRASES.test(piece)) {
        kind = "preferred";
      } else if (REQUIRED_PHRASES.test(piece)) {
        kind = "required";
      }
      sentences.push({ text: piece, kind });
    }
  }
  return sentences;
}

/** Collects the candidate terms (known list, posting skills, profile terms), one spelling each. */
function candidateTerms(
  postingSkills: readonly string[],
  profileSpellings: ReadonlyMap<string, string>,
): Map<string, { term: string; listedBySkills: boolean }> {
  const candidates = new Map<string, { term: string; listedBySkills: boolean }>();
  for (const known of KNOWN_TECHNOLOGIES) {
    candidates.set(known.term.toLowerCase(), { term: known.term, listedBySkills: false });
  }
  for (const spelling of profileSpellings.values()) {
    const key = spelling.toLowerCase();
    if (!candidates.has(key)) {
      candidates.set(key, { term: spelling, listedBySkills: false });
    }
  }
  for (const skill of postingSkills) {
    const term = skill.trim();
    if (term === "" || term.length > 40) {
      continue;
    }
    const existing = candidates.get(term.toLowerCase());
    candidates.set(term.toLowerCase(), {
      term: existing?.term ?? term,
      listedBySkills: true,
    });
  }
  return candidates;
}

/**
 * Finds the core requirements of a job, heaviest first, at most `MAXIMUM_REQUIREMENTS`.
 *
 * Weight of a term: 1 for every mention, 3 more for every mention in a sentence that asks firmly
 * ("required", "must", "strong", or under a "Requirements" heading), half a point for a mention
 * in a "nice to have" sentence, 2 more when the term is in the job title and 2 more when the
 * posting lists it as a skill. Importance is `required` if any mention asks firmly, `preferred`
 * if every mention is a wish, otherwise `mentioned`. Ties keep alphabetical order.
 *
 * `profileSpellings` maps each lower-cased profile term to its written form, so a term the user
 * holds is recognised in the job text even if it is not in the known list.
 *
 * Example: text "Required: Kafka and Kafka streams. Nice to have: Redis." gives Kafka (required,
 * weight 8) ahead of Redis (preferred, weight 0.5).
 */
export function findRequirements(
  jobTitle: string,
  jobText: string,
  postingSkills: readonly string[],
  profileSpellings: ReadonlyMap<string, string>,
): FoundRequirement[] {
  const sentences = splitSentences(jobText);
  const found: FoundRequirement[] = [];
  for (const candidate of candidateTerms(postingSkills, profileSpellings).values()) {
    if (candidate.term.length <= SHORT_TERM_LENGTH && !candidate.listedBySkills) {
      continue;
    }
    let weight = 0;
    let firm = 0;
    let wishes = 0;
    let mentions = 0;
    for (const sentence of sentences) {
      const count =
        candidate.term.length <= SHORT_TERM_LENGTH ? 0 : countTerm(sentence.text, candidate.term);
      mentions += count;
      if (sentence.kind === "required") {
        firm += count;
        weight += count * (1 + REQUIRED_MENTION_BONUS);
      } else if (sentence.kind === "preferred") {
        wishes += count;
        weight += count * PREFERRED_MENTION_WEIGHT;
      } else {
        weight += count;
      }
    }
    if (candidate.listedBySkills) {
      weight += LISTED_SKILL_BONUS;
    }
    if (containsTerm(jobTitle, candidate.term)) {
      weight += TITLE_BONUS;
    }
    if (mentions === 0 && !candidate.listedBySkills && weight === 0) {
      continue;
    }
    const importance: RequirementImportance =
      firm > 0 ? "required" : mentions > 0 && wishes === mentions ? "preferred" : "mentioned";
    found.push({ term: candidate.term, weight: Math.round(weight * 10) / 10, importance });
  }
  return found
    .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
    .slice(0, MAXIMUM_REQUIREMENTS);
}
