/**
 * Sorts a form question into one of Scout's six kinds with plain keyword rules.
 *
 * Why: the kind decides what Scout may do. Factual questions can be answered from the profile;
 * motivational ones need a drafted answer a person approves; legal, demographic, salary and
 * personal ones are never guessed (IDEA section 5.10).
 *
 * Example: `classifyQuestion("Are you authorised to work in the EU?")` is `"legal"`;
 * `classifyQuestion("Why do you want to work here?")` is `"motivational"`;
 * `classifyQuestion("How did you hear about us?")` is `"factual"`.
 * The rules run in a fixed order (demographic, legal, salary, motivational, personal, factual)
 * and the first match wins, so a question that fits two kinds gets the more careful one.
 */
import type { AnswerKind } from "../shared/index.js";

/** One rule: a kind and the pattern that, when it matches the question, selects that kind. */
interface KindRule {
  kind: AnswerKind;
  pattern: RegExp;
}

/** The ordered rules. Order matters: earlier rules are the more careful kinds. */
const KIND_RULES: readonly KindRule[] = [
  {
    kind: "demographic",
    pattern:
      /\b(gender|sex|race|racial|ethnic\w*|hispanic|latino|veteran|disabilit\w*|disabled|sexual orientation|pronouns?|transgender|lgbt\w*|religio\w*|marital)\b/i,
  },
  {
    kind: "legal",
    pattern:
      /\b(authori[sz]ed|authori[sz]ation|visa|sponsor\w*|legally|right to work|work permit|citizen\w*|criminal|convicted|felony|background check|non-?compete|export control|security clearance|privacy|consent|i agree|i certify|terms|gdpr|data processing)\b/i,
  },
  {
    kind: "salary",
    pattern:
      /\b(salary|salaries|compensation|pay expectations?|expected ctc|current ctc|hourly rate|desired pay)\b/i,
  },
  {
    kind: "motivational",
    pattern:
      /\b(why (do|are|would|did)|describe a time|tell us about|tell us why|what excites|what motivates|motivat\w*|cover letter|interested in|passionate|proudest|biggest challenge|greatest strength|about yourself)\b/i,
  },
  {
    kind: "personal",
    pattern:
      /\b(relocat\w*|willing to|open to|comfortable (with|working)|notice period|start date|earliest start|available to start|travel|commute|work on-?site|in-?office)\b/i,
  },
];

/** Decides the kind of one question. Anything no rule matches is `"factual"`. */
export function classifyQuestion(question: string): AnswerKind {
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(question)) return rule.kind;
  }
  return "factual";
}
