/**
 * Public surface of the brain module. Other modules import only from here (or from `src/shared`).
 *
 * Typical use: build a router from a command brain per engine, a budget and a cache, then call
 * `router.run({ task, instructions, untrustedText, schema })` and handle `ok: false` by degrading.
 */
export { createBrainRouter, buildCacheKey, type BrainRouterOptions } from "./router.js";
export { createCommandBrain, type CommandBrainOptions } from "./command-brain.js";
export { createFakeBrain, type FakeBrain, type RecordedReply } from "./fake-brain.js";
export { buildPrompt } from "./prompt.js";
export { detectLimit, type LimitDetection } from "./limit-detection.js";
export { extractFirstJson, type JsonFind } from "./json-extract.js";
export {
  ENGINE_CONFIGURATIONS,
  buildClaudeArguments,
  buildCodexArguments,
  type EngineConfiguration,
  type EngineName,
} from "./engines.js";
export {
  createProcessRunner,
  DEFAULT_PROCESS_LIMITS,
  type ProcessLimits,
  type ProcessResult,
  type ProcessRunner,
} from "./process-runner.js";
export { createMemoryCache, createFileCache, type BrainCache, type CachedReply } from "./cache.js";
export {
  createDailyBudget,
  createFileDailyBudget,
  type BudgetOptions,
  type BudgetTake,
  type CallBudget,
} from "./budget.js";
export {
  checkClaims,
  claimRetryInstructions,
  extractClaims,
  type Claim,
  type ClaimCheckResult,
  type ClaimKind,
  type ClaimSupport,
  type UnsupportedClaim,
} from "./claims.js";
export {
  proposeWording,
  type ProposeWordingOptions,
  type ProposeWordingResult,
  type WordingPoint,
} from "./wording.js";
