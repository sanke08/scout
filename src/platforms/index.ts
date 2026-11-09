/** Public surface of the platforms module. Other modules import only from this file. */
export {
  KNOWN_PLATFORMS,
  findKnownPlatform,
  hostBelongsToPlatform,
  normalisePlatformName,
  platformForUrl,
  type KnownPlatform,
} from "./catalog.js";
export {
  createProcessCommandRunner,
  type CommandResult,
  type CommandRunner,
} from "./command-runner.js";
export {
  createCredentialVault,
  serviceNameFor,
  type CredentialVault,
  type PlatformCredentials,
  type VaultOptions,
} from "./credential-vault.js";
export {
  AUTO_LOGIN_WAIT_MILLISECONDS,
  autoLogin,
  manualLogin,
  type AutoLoginResult,
  type LoginContext,
} from "./login.js";
export { createSessionStore, type PlatformSession, type SessionStore } from "./session-store.js";
export { resolveVault, type PlatformOverrides } from "./platform-overrides.js";
