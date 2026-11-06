/** Public surface of the apply module. Other modules import only from this file. */
export type { BrowserDriver } from "./driver.js";
export { saveEvidence, type EvidenceInput } from "./evidence.js";
export { fillAndVerify, type FillOutcome, type Mismatch } from "./fill-engine.js";
export {
  FIELD_TYPES,
  type FieldType,
  type FormField,
  type FormSnapshot,
  type SubmitControl,
} from "./form-types.js";
export { classifyQuestion } from "./classify-question.js";
export {
  findBankAnswer,
  mapFields,
  matchOption,
  type FieldMapping,
  type MappingSource,
  type MappingStatus,
} from "./map-fields.js";
export {
  detectPageBlocker,
  looksLikeConfirmation,
  type PageBlocker,
  type PageBlockerKind,
} from "./page-checks.js";
export {
  planApplication,
  type Blocker,
  type FillAction,
  type FillActionKind,
  type FillPlan,
  type LeftBlank,
  type PlanInput,
} from "./plan.js";
export type { PlaywrightDriverOptions } from "./playwright-driver.js";
export { createPlaywrightDriver } from "./playwright-loader.js";
export {
  mayAutoSubmit,
  runApplication,
  type RunArguments,
  type RunMode,
  type RunOutcome,
  type RunResult,
} from "./run-application.js";
export { runSelfTest, type SelfTestFixture, type SelfTestResult } from "./self-test.js";
export { snapshotForm } from "./snapshot.js";
