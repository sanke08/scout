/**
 * Maps every field of a form snapshot to something Scout may type: a profile value, an approved
 * answer from the answer bank, the resume file, or "nothing yet".
 *
 * Why: IDEA 5.10 says Scout reads the form into a list, maps each field to a profile value, an
 * approved answer or "unknown", and stops if a required field is unknown. This module does the
 * mapping and never guesses: legal, demographic, salary and personal questions that are not in
 * the bank are marked `needs-you`.
 *
 * Example: for a form with "Email" and "Are you open to relocating to Berlin?" and a profile
 * whose bank does not hold the second question, `mapFields` returns `ready` (value from the
 * identity) for Email and `needs-you` (kind `personal`) for the second field.
 */
import type { AnswerEntry, AnswerKind, Identity, Profile, Settings } from "../shared/index.js";
import { classifyQuestion } from "./classify-question.js";
import type { FormField, FormSnapshot } from "./form-types.js";

/**
 * Where a ready value comes from.
 * - `identity`: the profile's identity block.
 * - `answer-bank`: an approved answer.
 * - `demographic-setting`: the "prefer not to say" setting picked a matching option.
 * - `resume`: the resume file Scout built for this job.
 */
export type MappingSource = "identity" | "answer-bank" | "demographic-setting" | "resume";

/**
 * What mapping found for one field.
 * - `ready`: Scout knows what to put in it.
 * - `needs-you`: a person must answer; Scout never guesses this kind of question.
 * - `draft-needed`: a motivational question; a caller may ask the model for a draft, which the
 *   user approves into the bank before it is used.
 * - `unknown`: Scout has no value and no rule for it.
 */
export type MappingStatus = "ready" | "needs-you" | "draft-needed" | "unknown";

/** The result for one field, with a plain-words reason a person can read. */
export interface FieldMapping {
  field: FormField;
  /** The question kind, or `"identity"` for contact details and `"file"` for uploads. */
  kind: AnswerKind | "identity" | "file";
  status: MappingStatus;
  /** Present when `status` is `ready`, except for the resume (the file path is added by the plan). */
  value?: string;
  source?: MappingSource;
  reason: string;
}

/** Lower-cases, turns punctuation into spaces and collapses spaces, so questions compare fairly. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the bank entry was approved by the user (it carries an approval date). */
function isApproved(entry: AnswerEntry): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(entry.approvedOn);
}

/**
 * Finds the approved bank entry for a question: same words, or one question contains the other
 * (both at least 12 characters, so a short word cannot match everything).
 * Example: the bank question "What is your notice period?" matches the field "Notice period".
 */
export function findBankAnswer(question: string, bank: AnswerEntry[]): AnswerEntry | undefined {
  const wanted = normaliseText(question);
  if (wanted === "") return undefined;
  const approved = bank.filter(isApproved);
  const exact = approved.find((entry) => normaliseText(entry.question) === wanted);
  if (exact !== undefined) return exact;
  return approved.find((entry) => {
    const stored = normaliseText(entry.question);
    if (stored.length < 12 || wanted.length < 12) return false;
    return stored.includes(wanted) || wanted.includes(stored);
  });
}

/**
 * Picks the option of a select or radio group that says the same as `answer`.
 * Example: answer "Yes." matches the option "Yes, I am authorised"; "Maybe" matches nothing.
 */
export function matchOption(options: string[], answer: string): string | undefined {
  const wanted = normaliseText(answer);
  if (wanted === "") return undefined;
  const exact = options.find((option) => normaliseText(option) === wanted);
  if (exact !== undefined) return exact;
  return options.find((option) => normaliseText(option).startsWith(`${wanted} `));
}

/** Option wording that means "I would rather not say". */
const PREFER_NOT_TO_SAY =
  /prefer not|decline|do not wish|don'?t wish|rather not|choose not|not to (say|answer|disclose)/i;

/** Types of field that take free text (as opposed to a choice or a file). */
const TEXT_TYPES = ["text", "email", "tel", "url", "number"];

/** Splits "Alex Rivera" into a first and a last name; the last word is the last name. */
function splitName(fullName: string): { first: string; last: string } {
  const words = fullName.trim().split(/\s+/);
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  const first = words.length > 1 ? words.slice(0, -1).join(" ") : (words[0] ?? "");
  return { first, last };
}

/** One identity rule: which profile value fits a field whose label and name match `pattern`. */
interface IdentityRule {
  pattern: RegExp;
  /** When true the pattern is tested on the label alone; otherwise on the label and the field name. */
  labelOnly?: boolean;
  valueOf: (identity: Identity) => string | undefined;
}

/** Identity rules in order; more specific ones first (LinkedIn before "website"). */
const IDENTITY_RULES: readonly IdentityRule[] = [
  { pattern: /first name|given name|forename/, valueOf: (who) => splitName(who.name).first },
  { pattern: /last name|family name|surname/, valueOf: (who) => splitName(who.name).last },
  { pattern: /e ?mail/, valueOf: (who) => who.email },
  { pattern: /phone|mobile|telephone/, valueOf: (who) => who.phone },
  { pattern: /linkedin/, valueOf: (who) => who.linkedin },
  { pattern: /github/, valueOf: (who) => who.github },
  { pattern: /portfolio|website|personal site|personal url/, valueOf: (who) => who.portfolio },
  { pattern: /^(full |your |legal )?name$/, labelOnly: true, valueOf: (who) => who.name },
  { pattern: /\b(current )?location\b|\bcity\b/, valueOf: (who) => who.location },
];

/** Finds the identity value for a short text field, or `undefined` when no rule fits. */
function identityValueFor(field: FormField, identity: Identity): string | undefined {
  if (!TEXT_TYPES.includes(field.type)) return undefined;
  if (field.label.includes("?") || field.label.length > 60) return undefined;
  const labelText = normaliseText(field.label);
  const bothText = normaliseText(`${field.label} ${field.name}`);
  for (const rule of IDENTITY_RULES) {
    const text = rule.labelOnly === true ? labelText : bothText;
    if (rule.pattern.test(text)) return rule.valueOf(identity);
  }
  return undefined;
}

/** Builds a `ready` mapping. */
function ready(
  field: FormField,
  kind: FieldMapping["kind"],
  source: MappingSource,
  value: string | undefined,
  reason: string,
): FieldMapping {
  const mapping: FieldMapping = { field, kind, status: "ready", source, reason };
  if (value !== undefined) mapping.value = value;
  return mapping;
}

/** Turns an approved bank answer into a value that fits the field, or explains why it cannot. */
function mapBankAnswer(field: FormField, entry: AnswerEntry, kind: AnswerKind): FieldMapping {
  const reason = `Uses your approved answer to "${entry.question}".`;
  if (field.type === "file") {
    return {
      field,
      kind,
      status: "needs-you",
      reason: "A file field cannot be filled from a text answer.",
    };
  }
  if (field.type === "select" || field.type === "radio" || field.options.length > 0) {
    const option = matchOption(field.options, entry.answer);
    if (option === undefined) {
      return {
        field,
        kind,
        status: "needs-you",
        reason: `Your approved answer "${entry.answer}" is not one of this form's choices (${field.options.join(", ")}). Pick one yourself.`,
      };
    }
    return ready(field, kind, "answer-bank", option, reason);
  }
  if (field.type === "checkbox") {
    const answer = normaliseText(entry.answer);
    if (["yes", "true", "checked", "i agree", "agree"].includes(answer)) {
      return ready(field, kind, "answer-bank", "true", reason);
    }
    if (["no", "false", "unchecked"].includes(answer)) {
      return ready(field, kind, "answer-bank", "false", reason);
    }
    return {
      field,
      kind,
      status: "needs-you",
      reason: `Your approved answer "${entry.answer}" is not a yes or a no, so the tick box was left to you.`,
    };
  }
  return ready(field, kind, "answer-bank", entry.answer, reason);
}

/** Maps a question that is not in the bank, following the never-guess rules. */
function mapUnansweredQuestion(
  field: FormField,
  kind: AnswerKind,
  settings: Settings,
): FieldMapping {
  if (kind === "demographic" && settings.demographicAnswers === "prefer-not-to-say") {
    const option = field.options.find((candidate) => PREFER_NOT_TO_SAY.test(candidate));
    if (option !== undefined) {
      return ready(
        field,
        kind,
        "demographic-setting",
        option,
        'Your setting is "prefer not to say" and the form offers that choice.',
      );
    }
    return {
      field,
      kind,
      status: "needs-you",
      reason:
        'Your setting is "prefer not to say" but this field has no such choice, so it is left to you.',
    };
  }
  if (kind === "motivational") {
    return {
      field,
      kind,
      status: "draft-needed",
      reason: "This is an open question about you. A draft must be written and approved first.",
    };
  }
  if (kind === "factual") {
    return {
      field,
      kind,
      status: "unknown",
      reason: "No profile value or approved answer fits this question.",
    };
  }
  const reasons: Record<Exclude<AnswerKind, "factual" | "motivational">, string> = {
    legal: "This is a legal question and is not in your answer bank. Scout never guesses these.",
    demographic: 'Your setting is "ask each time", so this question is left to you.',
    salary: "This is a salary question and is not in your answer bank. Scout never guesses these.",
    personal:
      "This is a personal question and is not in your answer bank. Scout never guesses these.",
  };
  return { field, kind, status: "needs-you", reason: reasons[kind] };
}

/** Maps one field. See `mapFields` for the order of the checks. */
function mapOneField(
  field: FormField,
  profile: Profile,
  bank: AnswerEntry[],
  settings: Settings,
): FieldMapping {
  if (field.type === "file") {
    if (/resume|\bcv\b|curriculum/i.test(`${field.label} ${field.name}`)) {
      return ready(field, "file", "resume", undefined, "Uploads the resume built for this job.");
    }
    if (/cover/i.test(field.label)) {
      return {
        field,
        kind: "motivational",
        status: "draft-needed",
        reason: "A cover letter must be written and approved first.",
      };
    }
    return {
      field,
      kind: "file",
      status: "unknown",
      reason: "Scout does not know which file this field wants.",
    };
  }
  const identityValue = identityValueFor(field, profile.identity);
  if (identityValue !== undefined && identityValue !== "") {
    return ready(
      field,
      "identity",
      "identity",
      identityValue,
      "Taken from the identity in your profile.",
    );
  }
  const kind = classifyQuestion(field.label);
  const entry = findBankAnswer(field.label, bank);
  if (entry !== undefined) return mapBankAnswer(field, entry, kind);
  return mapUnansweredQuestion(field, kind, settings);
}

/**
 * Maps every field of `snapshot`, in page order.
 *
 * Order of checks per field: file inputs (resume, cover letter); identity details from the
 * profile; an approved bank answer; then the never-guess rules by question kind.
 * Example: `mapFields(snapshot, profile, profile.answerBank, settings)`.
 */
export function mapFields(
  snapshot: FormSnapshot,
  profile: Profile,
  answerBank: AnswerEntry[],
  settings: Settings,
): FieldMapping[] {
  return snapshot.fields.map((field) => mapOneField(field, profile, answerBank, settings));
}
