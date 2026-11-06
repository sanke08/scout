/**
 * Checks a model-written note against the repository text and builds the final "do not claim"
 * list.
 *
 * Why: the model may name a technology the project does not use, or quote a figure it made up.
 * This is the model-free step that drops them. It also guarantees the "do not claim" list always
 * exists and always carries Scout's own warnings, whatever the repository text tried to say.
 *
 * Nothing here reads the verdict from the repository: the verdict stays exactly what the model
 * returned, and text inside the repository cannot change this logic.
 */
import { containsTerm, toOneLine } from "./text-match.js";
import type { ProjectNoteReply } from "./note-schema.js";

/**
 * A note after verification.
 * - `note`: the reply with only verified stack terms and figures and the final do-not-claim list.
 * - `droppedStackTerms`: stack terms not found in the configuration or code.
 * - `droppedFigures`: figures not found in the configuration or code.
 */
export interface VerifiedNote {
  note: ProjectNoteReply;
  droppedStackTerms: string[];
  droppedFigures: string[];
}

/** Statements that are never safe to make from a repository alone, added to every note. */
const ALWAYS_DO_NOT_CLAIM: readonly string[] = [
  "That it is production ready, deployed, or used by real users: nothing in the repository proves it.",
  "Anything the README says that the code does not show.",
];

/** The extra warning each verdict other than "real project" carries. */
const VERDICT_WARNINGS: Readonly<Record<string, string>> = {
  "tutorial copy": "That the design is the user's own: the verdict is tutorial copy.",
  demo: "That it is more than a demo.",
  unfinished: "That it is finished.",
};

/** Adds `statement` to `list` unless the same text (ignoring capitalisation) is already there. */
function addOnce(list: string[], statement: string): void {
  const clean = toOneLine(statement);
  if (clean !== "" && !list.some((item) => item.toLowerCase() === clean.toLowerCase())) {
    list.push(clean);
  }
}

/**
 * Verifies `reply` against `evidence` (the configuration and code text of the digest).
 *
 * - A stack term is kept only if it appears in `evidence` as a whole term, ignoring capitalisation.
 * - A figure is kept only if it appears in `evidence` the same way.
 * - The do-not-claim list is: Scout's two standing warnings, the verdict's warning, one line per
 *   feature that is not fully built, one line per dropped term or figure, then the model's own.
 *
 * Example: stack `["Go", "Kafka"]` with evidence that never says Kafka keeps `["Go"]`, reports
 * `["Kafka"]` as dropped and adds "Use of Kafka: not found..." to the do-not-claim list.
 */
export function verifyNote(reply: ProjectNoteReply, evidence: string): VerifiedNote {
  const stack: string[] = [];
  const droppedStackTerms: string[] = [];
  for (const term of reply.stack) {
    (containsTerm(evidence, term) ? stack : droppedStackTerms).push(term);
  }
  const numbers: ProjectNoteReply["numbers"] = [];
  const droppedFigures: string[] = [];
  for (const entry of reply.numbers) {
    if (containsTerm(evidence, entry.figure)) {
      numbers.push(entry);
    } else {
      droppedFigures.push(entry.figure);
    }
  }

  const doNotClaim: string[] = [];
  for (const statement of ALWAYS_DO_NOT_CLAIM) {
    addOnce(doNotClaim, statement);
  }
  const verdictWarning = VERDICT_WARNINGS[reply.verdict.kind];
  if (verdictWarning !== undefined) {
    addOnce(doNotClaim, verdictWarning);
  }
  for (const feature of reply.features) {
    if (feature.status !== "built") {
      addOnce(doNotClaim, `That "${feature.name}" is complete: it is ${feature.status}.`);
    }
  }
  for (const term of droppedStackTerms) {
    addOnce(doNotClaim, `Use of ${term}: not found in the project's configuration or code.`);
  }
  for (const figure of droppedFigures) {
    addOnce(doNotClaim, `The figure ${figure}: not found in the project's configuration or code.`);
  }
  for (const statement of reply.doNotClaim) {
    addOnce(doNotClaim, statement);
  }

  return {
    note: { ...reply, stack, numbers, doNotClaim },
    droppedStackTerms,
    droppedFigures,
  };
}
