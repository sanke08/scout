/** Public surface of the web module. Other modules import only from here. */
export { startWebServer } from "./server.js";
export { SKIP_TAGS } from "./schemas.js";
export {
  createActionRunner,
  type ActionDefinition,
  type ActionOutcome,
  type ActionResult,
  type ActionRunner,
  type ActionState,
} from "./action-runner.js";
export type {
  DigestAnswer,
  DigestCard,
  DigestProvider,
  PendingProposal,
  PlatformControl,
  RunningWebServer,
  WebDependencies,
  WebServerOptions,
} from "./types.js";
