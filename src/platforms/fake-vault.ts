/**
 * An in-memory credential vault for tests only: no keychain, no terminal.
 *
 * Why: tests of sign-in must run with a made-up password and prove where it went. The fake counts
 * every read so a test can say "the password was never even fetched" for a hostile page.
 *
 * Example: `createFakeVault({ stored: { linkedin: { username: "alex@example.com", password: "not-a-real-password" } } })`.
 * Only test files import this file; it is not part of the public interface.
 */
import type { CredentialVault, PlatformCredentials } from "./credential-vault.js";

/** Settings for the fake. */
export interface FakeVaultOptions {
  /** Credentials already stored, by platform. */
  stored?: Record<string, PlatformCredentials>;
  /** What `isSupported` answers. Default true. */
  supported?: boolean;
  /** The password that `save` stores (the real keychain asks the user; the fake has no keyboard). */
  passwordOnSave?: string;
}

/** The fake plus what happened to it. */
export interface FakeVault extends CredentialVault {
  /** How many times a password was read. */
  readonly reads: string[];
  /** Platforms saved, in order. */
  readonly saves: string[];
  /** Platforms forgotten, in order. */
  readonly forgets: string[];
}

/** Creates the fake described in the file comment. */
export function createFakeVault(options: FakeVaultOptions = {}): FakeVault {
  const stored = new Map<string, PlatformCredentials>(Object.entries(options.stored ?? {}));
  const reads: string[] = [];
  const saves: string[] = [];
  const forgets: string[] = [];
  return {
    reads,
    saves,
    forgets,
    isSupported: () => options.supported ?? true,
    async save(platform, username) {
      saves.push(platform);
      stored.set(platform, { username, password: options.passwordOnSave ?? "not-a-real-password" });
    },
    async exists(platform, username) {
      return stored.get(platform)?.username === username;
    },
    async read(platform, username) {
      reads.push(platform);
      const found = stored.get(platform);
      return found?.username === username ? { ...found } : undefined;
    },
    async forget(platform) {
      forgets.push(platform);
      return stored.delete(platform);
    },
  };
}
