/**
 * What a test may replace in the platforms module, and the rule that turns it into a real vault.
 *
 * Why it exists: `scout login --save` and the automatic sign-in must never touch a real keychain
 * in a test. The real program passes nothing and gets the operating system's keychain.
 *
 * Example: `resolveVault({ vault: createFakeVault() })` returns that fake; `resolveVault(undefined)`
 * returns the real keychain vault.
 */
import { createProcessCommandRunner, type CommandRunner } from "./command-runner.js";
import { createCredentialVault, type CredentialVault } from "./credential-vault.js";

/** The parts a caller may replace. Anything left out keeps its real default. */
export interface PlatformOverrides {
  /** Replaces the credential vault entirely. Tests pass a fake. */
  vault?: CredentialVault;
  /** Replaces the program runner of the real vault. Ignored when `vault` is given. */
  runner?: CommandRunner;
  /** Replaces the operating system name the real vault checks. Ignored when `vault` is given. */
  operatingSystem?: string;
}

/** Returns the vault to use: the override, or the real keychain vault. */
export function resolveVault(overrides: PlatformOverrides | undefined): CredentialVault {
  if (overrides?.vault !== undefined) return overrides.vault;
  return createCredentialVault({
    runner: overrides?.runner ?? createProcessCommandRunner(),
    ...(overrides?.operatingSystem === undefined
      ? {}
      : { operatingSystem: overrides.operatingSystem }),
  });
}
