/**
 * The credential vault: platform usernames and passwords live only in the operating system's
 * keychain, reached through its own command-line program.
 *
 * Why it exists: the owner may let Scout sign in by itself (Settings: "saved"). The password must
 * then be stored where only the user's login can read it, and Scout must never hold it longer than
 * one sign-in. The rules of this file:
 * - Saving: Scout starts the keychain program attached to the user's terminal, so the program
 *   itself asks for the password. Scout never receives it and never puts it in a command line.
 * - Reading: only for one sign-in. The password is captured in memory, returned to the caller and
 *   never written anywhere by this file.
 * - Nothing here reads a password from a file or an environment variable.
 * - macOS uses `security`; Linux uses `secret-tool`; every other system answers `unavailable`
 *   and manual sign-in still works.
 *
 * Example: `await vault.save("linkedin", "alex@example.com")` shows the keychain's own prompt;
 * later `await vault.read("linkedin", "alex@example.com")` gives
 * `{ username: "alex@example.com", password: "..." }`.
 * Honest status: never run against a real keychain; tests use a fake runner.
 */
import { ScoutError } from "../shared/index.js";
import type { CommandRunner } from "./command-runner.js";

/** One stored sign-in. The password exists only in memory, for the length of one sign-in. */
export interface PlatformCredentials {
  username: string;
  password: string;
}

/** Stores and fetches platform credentials. */
export interface CredentialVault {
  /** True when this computer has a keychain program Scout knows. Does not prove the program is installed. */
  isSupported(): boolean;
  /** Stores the password for `username` by letting the keychain program ask the user for it. */
  save(platform: string, username: string): Promise<void>;
  /** True when a credential for this platform and username is stored. Never reads the password. */
  exists(platform: string, username: string): Promise<boolean>;
  /** The stored credentials, or `undefined` when none are stored. Never log the result. */
  read(platform: string, username: string): Promise<PlatformCredentials | undefined>;
  /** Deletes the stored credential and returns whether one was removed. Without a username it removes the platform's one item. */
  forget(platform: string, username?: string): Promise<boolean>;
}

/** The inputs of `createCredentialVault`. */
export interface VaultOptions {
  /** Starts the keychain program. */
  runner: CommandRunner;
  /** The operating system name as Node reports it (`darwin`, `linux`, ...). Default: the real one. */
  operatingSystem?: string;
}

/** The keychain service name for a platform, so every platform has its own item. */
export function serviceNameFor(platform: string): string {
  return `scout-platform-${platform}`;
}

/** Longest username Scout accepts. */
const MAXIMUM_USERNAME_LENGTH = 200;

/**
 * Checks a platform name and username before they reach a command line. Failure:
 * `ScoutError("invalid-input")`; the message never contains a password.
 */
function assertSafeNames(platform: string, username: string | undefined): void {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(platform)) {
    throw new ScoutError("invalid-input", `"${platform}" is not a valid platform name.`);
  }
  if (username === undefined) return;
  // eslint-disable-next-line no-control-regex
  const hasControlCharacter = /[\u0000-\u001f\u007f]/.test(username);
  if (username.trim() === "" || username.length > MAXIMUM_USERNAME_LENGTH || hasControlCharacter) {
    throw new ScoutError(
      "invalid-input",
      "The username must be one line of text, not empty and not longer than 200 characters.",
    );
  }
}

/** The error for a computer without a usable keychain program. The wording says manual sign-in still works. */
function unavailable(platform: string, why: string): ScoutError {
  return new ScoutError(
    "unavailable",
    `Credentials cannot be saved or read here: ${why}. Manual sign-in still works: run \`scout login ${platform}\` and sign in yourself in the browser window.`,
  );
}

/** Removes one trailing line break, which both keychain programs add after a printed password. */
function withoutTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/** The commands of one keychain program, so the vault logic below is the same for both systems. */
interface KeychainProgram {
  command: string;
  /** Why the system is unusable when the program is missing, in a few words. */
  missingReason: string;
  save(service: string, username: string): string[];
  exists(service: string, username: string): string[];
  read(service: string, username: string): string[];
  forget(service: string, username: string | undefined): string[];
}

/** macOS: the `security` program. `add-generic-password` without `-w` asks for the password itself. */
const MACOS_PROGRAM: KeychainProgram = {
  command: "security",
  missingReason: "the macOS `security` program was not found",
  save: (service, username) => ["add-generic-password", "-U", "-s", service, "-a", username],
  exists: (service, username) => ["find-generic-password", "-s", service, "-a", username],
  read: (service, username) => ["find-generic-password", "-s", service, "-a", username, "-w"],
  forget: (service, username) =>
    username === undefined
      ? ["delete-generic-password", "-s", service]
      : ["delete-generic-password", "-s", service, "-a", username],
};

/** Linux: the `secret-tool` program. `store` reads the password from the terminal prompt. */
const LINUX_PROGRAM: KeychainProgram = {
  command: "secret-tool",
  missingReason: "the `secret-tool` program (libsecret) was not found",
  save: (service, username) => [
    "store",
    `--label=Scout ${service}`,
    "service",
    service,
    "account",
    username,
  ],
  exists: (service, username) => ["lookup", "service", service, "account", username],
  read: (service, username) => ["lookup", "service", service, "account", username],
  forget: (service, username) =>
    username === undefined
      ? ["clear", "service", service]
      : ["clear", "service", service, "account", username],
};

/** The program for this system, or `undefined` for a system without one. */
function programFor(operatingSystem: string): KeychainProgram | undefined {
  if (operatingSystem === "darwin") return MACOS_PROGRAM;
  if (operatingSystem === "linux") return LINUX_PROGRAM;
  return undefined;
}

/** Builds the vault described in the file comment. */
export function createCredentialVault(options: VaultOptions): CredentialVault {
  const operatingSystem = options.operatingSystem ?? process.platform;
  const program = programFor(operatingSystem);
  const runner = options.runner;

  /** The program, or the "unavailable" error for a system without one. */
  function requireProgram(platform: string): KeychainProgram {
    if (program === undefined) {
      throw unavailable(
        platform,
        `Scout can use the macOS keychain or the Linux secret service, not "${operatingSystem}"`,
      );
    }
    return program;
  }

  return {
    isSupported: () => program !== undefined,

    async save(platform, username) {
      assertSafeNames(platform, username);
      const keychain = requireProgram(platform);
      const result = await runner.interactive(
        keychain.command,
        keychain.save(serviceNameFor(platform), username),
      );
      if (result.toolMissing) throw unavailable(platform, keychain.missingReason);
      if (result.exitCode !== 0) {
        throw new ScoutError(
          "unavailable",
          `The keychain did not store the credentials (exit code ${result.exitCode}), so nothing was saved. Manual sign-in still works: run \`scout login ${platform}\`.`,
        );
      }
    },

    async exists(platform, username) {
      assertSafeNames(platform, username);
      if (program === undefined) return false;
      // macOS answers "exists" without printing the password (no `-w`). The Linux program has no
      // such form, so there the password is read into memory and dropped at once.
      const result = await runner.captured(
        program.command,
        program.exists(serviceNameFor(platform), username),
      );
      if (result.toolMissing || result.exitCode !== 0) return false;
      return operatingSystem === "linux" ? withoutTrailingNewline(result.output) !== "" : true;
    },

    async read(platform, username) {
      assertSafeNames(platform, username);
      const keychain = requireProgram(platform);
      const result = await runner.captured(
        keychain.command,
        keychain.read(serviceNameFor(platform), username),
      );
      if (result.toolMissing) throw unavailable(platform, keychain.missingReason);
      if (result.exitCode !== 0) return undefined;
      const password = withoutTrailingNewline(result.output);
      return password === "" ? undefined : { username, password };
    },

    async forget(platform, username) {
      assertSafeNames(platform, username);
      const keychain = requireProgram(platform);
      const result = await runner.captured(
        keychain.command,
        keychain.forget(serviceNameFor(platform), username),
      );
      if (result.toolMissing) throw unavailable(platform, keychain.missingReason);
      // Exit code 44 on macOS means "no such item"; on Linux any failure is treated the same way.
      if (result.exitCode === 0) return true;
      if (operatingSystem === "darwin" && result.exitCode !== 44) {
        throw new ScoutError(
          "unavailable",
          `The keychain could not delete the saved credentials (exit code ${result.exitCode}). Open the Keychain Access app and delete the item named ${serviceNameFor(platform)}.`,
        );
      }
      return false;
    },
  };
}
