/** Public surface of the decide module. Other modules import only from this file. */
export { createDecider, type ScoutDecider } from "./decider.js";
export {
  applyHardRules,
  type CooldownContext,
  type HardRuleContext,
  type HardRuleDecision,
} from "./hard-rules.js";
export { isInCooldown, type AppliedApplication } from "./cooldown.js";
export { requiredYears } from "./rule-experience.js";
export { keywordScore } from "./keyword-score.js";
export { rankPostings, type RankedPosting } from "./rank-postings.js";
export { termsOfProfile } from "./profile-terms.js";
export {
  combineScores,
  confidenceBand,
  postingScoreSchema,
  scoreBatchResultSchema,
  type ConfidenceBand,
  type PostingScore,
  type ScoreBatchResult,
} from "./scoring-shapes.js";
export {
  MAXIMUM_POSTINGS_PER_REQUEST,
  buildScoreRequest,
  chunkForScoring,
} from "./score-request.js";
