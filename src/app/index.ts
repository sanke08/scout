/**
 * Public surface of the app module: the composition root, the discovery pass, the digest provider
 * and the command registration. `src/index.ts` and the end-to-end tests import only from here.
 */
export {
  createApplication,
  COOLDOWN_DAYS,
  type Application,
  type ApplicationOptions,
} from "./application.js";
export { createBoardStore, type BoardEntry, type BoardStore } from "./boards-store.js";
export { createScoreStore, type ScoreStore, type StoredScore } from "./score-store.js";
export { registerCommands } from "./commands/index.js";
export { registerMailAndNotesCommands } from "./commands/mail-register.js";
export { createDigestProvider, createPendingProposals, describeResume } from "./digest-provider.js";
export { runDiscoveryPass, type DiscoveryPassSummary, type FailedBoard } from "./discovery-pass.js";
export { createWebDependencies } from "./web-dependencies.js";
export {
  DEGRADED_KEYWORD_THRESHOLD,
  DEGRADED_SHORTLIST_LIMIT,
  SCORING_CANDIDATES_PER_PASS,
} from "./shortlist.js";
export { registerFoldersCommands } from "./commands/folders-register.js";
export { registerApplyCommands } from "./commands/apply-commands.js";
