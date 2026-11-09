/**
 * The two ways to sign in to a platform, over the same `BrowserDriver` the apply module uses.
 *
 * - `manualLogin`: opens the platform's sign-in page in Scout's own browser profile and waits for
 *   the user to sign in themselves. Scout types nothing.
 * - `autoLogin`: only for a platform the user set to "saved". Opens the sign-in page, checks it is
 *   really on the platform's own domain, types the credentials from the keychain, submits ONCE and
 *   looks at the result. A CAPTCHA, a one-time code, a "verify it's you" step or the sign-in form
 *   again means it stops, records the failure and asks the user to finish by hand. It never solves
 *   anything, never retries, and refuses to try more than once in six hours per platform so a
 *   wrong password can never lock the account.
 *
 * Secrets: the password is read from the vault at the last moment, passed to `driver.fill` and
 * dropped. It is never put in a result, an error, a log line or a record.
 *
 * Example: `await autoLogin(driver, "linkedin", vault, context)` gives `{ signedIn: true }` or
 * `{ signedIn: false, reason: "The page asks for a one-time code ..." }`.
 */
import { detectPageBlocker, type BrowserDriver } from "../apply/index.js";
import { ScoutError } from "../shared/index.js";
import { findKnownPlatform, hostBelongsToPlatform, type KnownPlatform } from "./catalog.js";
import type { CredentialVault } from "./credential-vault.js";
import { findLoginForm } from "./form-finder.js";
import type { SessionStore } from "./session-store.js";

/** How long Scout waits after one automatic sign-in attempt before it may try again (six hours). */
export const AUTO_LOGIN_WAIT_MILLISECONDS = 6 * 60 * 60 * 1000;

/** How long Scout lets the page settle after pressing the sign-in button, before it looks. */
const SETTLE_MILLISECONDS = 3000;

/** What the sign-in flows need from the outside. */
export interface LoginContext {
  sessions: SessionStore;
  now: () => Date;
  /** Shows a prompt and returns the typed line. */
  readLine: (prompt: string) => Promise<string>;
  /** Waits. */
  pause: (milliseconds: number) => Promise<void>;
}

/** The result of an automatic sign-in. A stop carries a full sentence for the user. */
export type AutoLoginResult = { signedIn: true } | { signedIn: false; reason: string };

/** Wording on a page that asks for more than a password ("verify it's you", a security checkpoint). */
const CHECKPOINT_PATTERN =
  /verify it['’]?s you|confirm it['’]?s you|quick security check|security checkpoint|suspicious (activity|sign-?in|login)|unusual (activity|sign-?in)|we need to verify/i;

/** The sentence for a stop, ending with what the user should do. */
function stopped(platform: string, what: string): AutoLoginResult {
  return {
    signedIn: false,
    reason: `${what} Scout did not try again; please finish signing in yourself with \`scout login ${platform}\`. Scout will not sign in by itself again for six hours.`,
  };
}

/** True when the address is an https page on the platform's own domain. */
function isOnPlatformDomain(address: string, platform: KnownPlatform): boolean {
  try {
    const parsed = new URL(address);
    return parsed.protocol === "https:" && hostBelongsToPlatform(parsed.hostname, platform);
  } catch {
    return false;
  }
}

/** The time Scout last tried an automatic sign-in on this platform (success or failure), if ever. */
function lastAttemptTime(sessions: SessionStore, platform: string): Date | undefined {
  const record = sessions.get(platform);
  const times = [record?.lastAutoLoginAt, record?.lastAutoLoginFailedAt]
    .filter((text): text is string => text !== undefined)
    .map((text) => new Date(text))
    .filter((time) => !Number.isNaN(time.getTime()));
  if (times.length === 0) return undefined;
  return new Date(Math.max(...times.map((time) => time.getTime())));
}

/**
 * Opens the platform's sign-in page and waits for the user to sign in. Records the time.
 * `loginAddress` is needed only for a platform Scout does not know.
 * Failure: an unknown platform without an address gives `ScoutError("invalid-input")`.
 */
export async function manualLogin(
  driver: BrowserDriver,
  platform: string,
  context: LoginContext,
  loginAddress?: string,
): Promise<void> {
  const address = findKnownPlatform(platform)?.loginUrl ?? loginAddress;
  if (address === undefined) {
    throw new ScoutError(
      "invalid-input",
      `Scout does not know the sign-in page of "${platform}". Give it with --url, for example: scout login ${platform} --url https://example.com/login.`,
    );
  }
  if (!/^https?:\/\//i.test(address)) {
    throw new ScoutError("invalid-input", `"${address}" is not a web address Scout can open.`);
  }
  await driver.open(address);
  await context.readLine(
    `Sign in yourself in the browser window that just opened (Scout types nothing). Press Enter here when you are signed in. `,
  );
  context.sessions.update(platform, { lastManualLoginAt: context.now().toISOString() });
}

/**
 * Signs in once with the credentials in the vault. See the file comment for every rule.
 * Failure: only for an unknown platform (`ScoutError("invalid-input")`) or a vault that cannot
 * work (`ScoutError("unavailable")`). Everything that happens on the page is a returned stop.
 */
export async function autoLogin(
  driver: BrowserDriver,
  platform: string,
  vault: CredentialVault,
  context: LoginContext,
): Promise<AutoLoginResult> {
  const known = findKnownPlatform(platform);
  if (known === undefined) {
    throw new ScoutError(
      "invalid-input",
      `Scout can sign in by itself only on known platforms (linkedin, indeed, naukri), not on "${platform}". Sign in yourself with \`scout login ${platform}\`.`,
    );
  }
  const username = context.sessions.get(platform)?.username;
  if (username === undefined || !(await vault.exists(platform, username))) {
    return {
      signedIn: false,
      reason: `No saved credentials for ${platform} were found. Store them with \`scout login ${platform} --save\`, or sign in yourself with \`scout login ${platform}\`.`,
    };
  }
  const lastAttempt = lastAttemptTime(context.sessions, platform);
  const now = context.now();
  if (
    lastAttempt !== undefined &&
    now.getTime() - lastAttempt.getTime() < AUTO_LOGIN_WAIT_MILLISECONDS
  ) {
    return {
      signedIn: false,
      reason: `Scout already tried to sign in to ${platform} by itself at ${lastAttempt.toISOString()}. It waits six hours between tries so the site does not lock your account. Sign in yourself with \`scout login ${platform}\`.`,
    };
  }

  await driver.open(known.loginUrl);
  if (!isOnPlatformDomain(await driver.currentUrl(), known)) {
    return stopped(
      platform,
      `The sign-in page for ${platform} led to a page that is not on ${known.domains[0] ?? platform}, so nothing was typed.`,
    );
  }
  const text = await driver.pageText();
  const html = await driver.pageHtml();
  const early = detectPageBlocker(text, html);
  if (early !== undefined && (early.kind === "captcha" || early.kind === "one-time-code")) {
    return stopped(platform, `${early.reason} Nothing was typed.`);
  }
  if (CHECKPOINT_PATTERN.test(text)) {
    return stopped(platform, "The page asks you to verify it is you. Nothing was typed.");
  }
  const form = findLoginForm(html);
  if (form === undefined) {
    return stopped(
      platform,
      "Scout could not find a plain sign-in form on the page (it may have more than one step). Nothing was typed.",
    );
  }

  const credentials = await vault.read(platform, username);
  if (credentials === undefined) {
    return {
      signedIn: false,
      reason: `The saved credentials for ${platform} could not be read from the keychain. Sign in yourself with \`scout login ${platform}\`.`,
    };
  }
  // The attempt is written down before anything is typed: if Scout stops half way, the wait
  // still applies and the account is never hit twice.
  context.sessions.update(platform, { lastAutoLoginFailedAt: now.toISOString() });
  if (!isOnPlatformDomain(await driver.currentUrl(), known)) {
    return stopped(platform, "The page moved to another site, so nothing was typed.");
  }
  try {
    await driver.fill(form.usernameSelector, credentials.username);
    await driver.fill(form.passwordSelector, credentials.password);
    await driver.submit(form.submitSelector);
  } catch {
    return stopped(platform, "The browser could not use the sign-in form.");
  }

  await context.pause(SETTLE_MILLISECONDS);
  const afterText = await driver.pageText();
  const afterHtml = await driver.pageHtml();
  const blocker = detectPageBlocker(afterText, afterHtml);
  if (blocker !== undefined) {
    const reason =
      blocker.kind === "login"
        ? "The sign-in form is still showing, so the site did not accept the sign-in."
        : blocker.reason;
    return stopped(platform, reason);
  }
  if (CHECKPOINT_PATTERN.test(afterText)) {
    return stopped(platform, "The site asks you to verify it is you.");
  }
  context.sessions.update(platform, {
    lastAutoLoginAt: context.now().toISOString(),
    lastAutoLoginFailedAt: undefined,
  });
  return { signedIn: true };
}
