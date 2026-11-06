/** Public surface of the store module. Other modules import only from here. */
export { createActionLog } from "./action-log.js";
export { createJobStore } from "./job-store.js";
export { CURRENT_SCHEMA_VERSION, openDatabase } from "./schema.js";
export { assertNotPaused, createSettingsStore } from "./settings-store.js";
export type { DatabaseSync } from "./sqlite-module.js";
export { ALLOWED_TRANSITIONS, TERMINAL_STATUSES, allowedNextStatuses } from "./transitions.js";
