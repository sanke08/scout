/**
 * The result of one hard rule for one posting. Every rule returns this same small shape so the
 * combining code can treat them alike.
 *
 * - `reason`: set when the rule drops the posting; a plain-words sentence.
 * - `note`: set when the rule kept the posting but the user should know something (for example
 *   "the salary is in another currency, so it was not checked").
 *
 * Example: `{ reason: "The salary tops out at 40000 EUR a year, below your floor of 60000." }`
 * means drop; `{}` means the rule has no objection.
 */
export interface RuleOutcome {
  reason?: string;
  note?: string;
}

/** The outcome of a rule that has no objection and nothing to add. */
export const NO_OBJECTION: RuleOutcome = {};
