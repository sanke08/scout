/**
 * The rules for changing how Scout signs in to a platform and how far it goes there, written once
 * for `scout platforms set` and for the web page's Control tab.
 *
 * Why it exists: both doors must refuse the same things (saved sign-in for an unknown site, saved
 * sign-in without a keychain) and both must make the owner type the platform name before a risky
 * choice on LinkedIn, Indeed or Naukri. Plain functions with no input or output keep them testable.
 *
 * Example: `isRiskyPlatformChoice("linkedin", { level: "auto" })` is `true`;
 * `isRiskyPlatformChoice("example", { level: "auto" })` is `false`.
 */
import { ScoutError, type BoardLevel, type PlatformLogin, type Settings } from "../shared/index.js";
import { findKnownPlatform } from "./catalog.js";
import type { CredentialVault } from "./credential-vault.js";

/** The warning shown before a known sign-in platform is set to `saved` or `auto`. */
export const AUTOMATION_WARNING =
  "Warning: automating this site (typing your password or submitting applications for you) may break its terms of use and could get your account restricted or closed. You are responsible for that risk. Manual sign-in and 'Fill, I submit' are the safe choices.";

/** What the owner wants to change for one platform. At least one of the two is set. */
export interface PlatformChoice {
  login?: PlatformLogin;
  level?: BoardLevel;
}

/**
 * True when the choice needs the platform name typed first: `saved` sign-in or `auto` apply level
 * on a platform Scout knows (linkedin, indeed, naukri). Other platforms have no automation to warn about.
 * Example: `isRiskyPlatformChoice("naukri", { login: "saved" })` is `true`.
 */
export function isRiskyPlatformChoice(platform: string, choice: PlatformChoice): boolean {
  const risky = choice.login === "saved" || choice.level === "auto";
  return risky && findKnownPlatform(platform) !== undefined;
}

/**
 * True when what was typed is the platform name (spaces and capitals do not matter).
 * Example: `confirmationMatches("linkedin", " LinkedIn ")` is `true`; `confirmationMatches("linkedin", "yes")` is `false`.
 */
export function confirmationMatches(platform: string, typed: string | undefined): boolean {
  return typed !== undefined && typed.trim().toLowerCase() === platform;
}

/**
 * Throws unless `saved` sign-in is possible for this platform on this computer. Does nothing for a
 * choice that is not `saved`.
 * Failure: `ScoutError("invalid-input")` for a platform Scout cannot sign in to,
 * `ScoutError("unavailable")` when there is no keychain.
 */
export function assertSavedLoginPossible(
  platform: string,
  choice: PlatformChoice,
  vault: CredentialVault,
): void {
  if (choice.login !== "saved") return;
  if (findKnownPlatform(platform) === undefined) {
    throw new ScoutError(
      "invalid-input",
      `Saved sign-in works only for linkedin, indeed and naukri, not "${platform}". Use manual sign-in for it.`,
    );
  }
  if (!vault.isSupported()) {
    throw new ScoutError(
      "unavailable",
      "Credentials cannot be saved on this computer (no keychain Scout knows), so saved sign-in is not possible. Manual sign-in still works.",
    );
  }
}

/**
 * Returns the settings with the choice written in; the input is not changed.
 * Example: `applyPlatformChoice(settings, "linkedin", { level: "fill" })` keeps everything else and
 * sets `boardLevels.linkedin` to `"fill"`.
 */
export function applyPlatformChoice(
  settings: Settings,
  platform: string,
  choice: PlatformChoice,
): Settings {
  const next = { ...settings };
  if (choice.login !== undefined) {
    next.platformLogins = { ...settings.platformLogins, [platform]: choice.login };
  }
  if (choice.level !== undefined) {
    next.boardLevels = { ...settings.boardLevels, [platform]: choice.level };
  }
  return next;
}

/** The action-log line for a change, e.g. `linkedin: login saved, level unchanged.` */
export function describePlatformChoice(platform: string, choice: PlatformChoice): string {
  return `${platform}: login ${choice.login ?? "unchanged"}, level ${choice.level ?? "unchanged"}.`;
}
