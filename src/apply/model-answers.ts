/**
 * Puts the answers an autopilot model gave for one application into the field mappings.
 *
 * Why it exists: `mapFields` only knows the profile and the approved answer bank. In autopilot the
 * model may answer the questions the profile cannot (it is responsible for those answers, and every
 * one is saved in the evidence). This is the one place that turns an answer into a `ready` mapping,
 * and it never lets an answer break the form: a choice that is not on the page's list, a file field
 * and an unknown field are refused with a reason, not typed.
 *
 * Rules: an answer only fills a field that the profile could not fill. A value the profile or the
 * approved bank already supplies is never replaced (identity facts and approved wording win).
 *
 * Example: a "Notice period" field that mapped as `unknown` and the answer `"30 days"` becomes
 * `ready` with source `model-answer`; the answer `"Maybe"` for a Yes/No drop-down is refused.
 */
import type { FieldMapping } from "./map-fields.js";
import { matchOption, normaliseText } from "./map-fields.js";

/** The longest answer accepted for one field. A form answer is never a document. */
export const MAXIMUM_ANSWER_LENGTH = 5000;

/** One answer that was not used, with a sentence saying why. */
export interface RefusedAnswer {
  fieldKey: string;
  reason: string;
}

/** What `applyModelAnswers` did. */
export interface ModelAnswerResult {
  /** The mappings with the accepted answers filled in, in the same order. */
  mappings: FieldMapping[];
  /** Answers that were not used (unknown field, not a listed choice, file field, too long). */
  refused: RefusedAnswer[];
  /** Answers for fields the profile already fills; the profile's value was kept. */
  ignored: RefusedAnswer[];
  /** Field key to the answer that was used, for the evidence file. */
  used: Record<string, string>;
}

/** Words that tick a box and words that leave it empty. */
const YES_WORDS = ["yes", "true", "checked", "i agree", "agree"];
const NO_WORDS = ["no", "false", "unchecked"];

/** Turns one answer into the value to type, or the reason it cannot be used. */
function valueFor(mapping: FieldMapping, answer: string): { value: string } | { reason: string } {
  const { field } = mapping;
  if (field.type === "file") {
    return { reason: "A file field cannot be filled from a text answer." };
  }
  if (field.type === "select" || field.type === "radio" || field.options.length > 0) {
    const option = matchOption(field.options, answer);
    if (option === undefined) {
      return {
        reason: `"${answer}" is not one of this field's choices. The choices are: ${field.options.join(", ")}.`,
      };
    }
    return { value: option };
  }
  if (field.type === "checkbox") {
    const wanted = normaliseText(answer);
    if (YES_WORDS.includes(wanted)) return { value: "true" };
    if (NO_WORDS.includes(wanted)) return { value: "false" };
    return { reason: `A tick box takes "yes" or "no", not "${answer}".` };
  }
  return { value: answer };
}

/** Applies `answers` (field key to text) to `mappings`. See the file comment for the rules. */
export function applyModelAnswers(
  mappings: FieldMapping[],
  answers: Record<string, string>,
): ModelAnswerResult {
  const refused: RefusedAnswer[] = [];
  const ignored: RefusedAnswer[] = [];
  const used: Record<string, string> = {};
  const byKey = new Map(mappings.map((mapping) => [mapping.field.key, mapping]));
  const resolved = new Map<string, FieldMapping>();

  for (const [fieldKey, rawAnswer] of Object.entries(answers)) {
    const mapping = byKey.get(fieldKey);
    const answer = rawAnswer.trim();
    if (mapping === undefined) {
      refused.push({
        fieldKey,
        reason: "The form has no field with this key. Use the keys from get_form.",
      });
    } else if (answer.length > MAXIMUM_ANSWER_LENGTH) {
      refused.push({
        fieldKey,
        reason: `The answer is longer than ${MAXIMUM_ANSWER_LENGTH} characters.`,
      });
    } else if (mapping.status === "ready") {
      ignored.push({
        fieldKey,
        reason: `The profile already fills this field (${mapping.reason})`,
      });
    } else if (answer === "") {
      refused.push({ fieldKey, reason: "The answer is empty." });
    } else {
      const outcome = valueFor(mapping, answer);
      if ("reason" in outcome) {
        refused.push({ fieldKey, reason: outcome.reason });
      } else {
        used[fieldKey] = outcome.value;
        resolved.set(fieldKey, {
          field: mapping.field,
          kind: mapping.kind,
          status: "ready",
          value: outcome.value,
          source: "model-answer",
          reason: "Answered by the autopilot model for this application.",
        });
      }
    }
  }
  return {
    mappings: mappings.map((mapping) => resolved.get(mapping.field.key) ?? mapping),
    refused,
    ignored,
    used,
  };
}
