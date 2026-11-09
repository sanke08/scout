/**
 * The pieces of applying that print nothing and ask nothing, shared by `scout apply` (which talks
 * to a person) and the autopilot tools (which talk to the model).
 *
 * Why it exists: both paths must plan a form, keep a window open, name the platform and sign in with
 * saved credentials in exactly the same way. Keeping one copy here means a safety fix lands in both.
 * Anything that prints or waits for a typed line stays in `apply-run.ts`.
 *
 * Example: `platformOfAddress("https://www.linkedin.com/jobs/view/1")` is `"linkedin"`.
 */
import {
  mapFields,
  planApplication,
  type BrowserDriver,
  type FieldMapping,
  type FillPlan,
  type FormSnapshot,
} from "../../apply/index.js";
import { autoLogin, findKnownPlatform, platformForUrl } from "../../platforms/index.js";
import { ScoutError, type Profile, type Settings } from "../../shared/index.js";
import type { Application } from "../application.js";
import type { PlatformServices } from "./platform-services.js";

/** Reads the form into mappings: the profile and the approved answer bank decide every field they can. */
export function mapForm(
  snapshot: FormSnapshot,
  profile: Profile,
  settings: Settings,
): FieldMapping[] {
  return mapFields(snapshot, profile, profile.answerBank, settings);
}

/** Plans the fill for a form that was already mapped. A plan with blockers is never carried out. */
export function planForm(
  url: string,
  snapshot: FormSnapshot,
  mappings: FieldMapping[],
  resumeFile: string | undefined,
): FillPlan {
  return planApplication({
    url,
    snapshot,
    mappings,
    ...(resumeFile === undefined ? {} : { resumeFilePath: resumeFile }),
  });
}

/** A driver that refuses every call. Level Prepare passes it so a bug could never open a page. */
export function refusingDriver(): BrowserDriver {
  const refuse = async (): Promise<never> => {
    throw new ScoutError(
      "unsafe",
      "A browser was used at level Prepare only, which must never open a page.",
    );
  };
  return {
    open: refuse,
    currentUrl: refuse,
    pageText: refuse,
    pageHtml: refuse,
    fill: refuse,
    select: refuse,
    upload: refuse,
    readValue: refuse,
    screenshot: refuse,
    submit: refuse,
    readConfirmation: refuse,
    close: async () => {},
  };
}

/**
 * The same driver with `close` doing nothing, so the window stays open after `runApplication`
 * (which closes its driver) and the owner can press submit. The caller closes the real one.
 */
export function keepOpen(driver: BrowserDriver): BrowserDriver {
  return { ...driver, close: async () => {} };
}

/** Closes a driver, ignoring a failure: the result of the run is already decided. */
export async function closeQuietly(driver: BrowserDriver): Promise<void> {
  try {
    await driver.close();
  } catch {
    // The window may already be gone.
  }
}

/** The platform of an application address, or `undefined` when the address cannot be read. */
export function platformOfAddress(url: string): string | undefined {
  try {
    return platformForUrl(url);
  } catch {
    return undefined;
  }
}

/** What `trySavedSignIn` needs. */
export interface SavedSignInInput {
  application: Application;
  settings: Settings;
  platforms: PlatformServices;
  driver: BrowserDriver;
  /** The application address; its platform decides whether a saved sign-in applies. */
  url: string;
  jobId: string;
  /** Told once, just before Scout signs in (the command prints it; the autopilot ignores it). */
  say: (line: string) => void;
}

/**
 * At a sign-in wall, signs in by itself when (and only when) the owner chose "saved" for this
 * platform and credentials exist. One attempt per run, no retry. Returns a note when the attempt
 * was made or was not possible, and `signedIn` when the page should be read again.
 */
export async function trySavedSignIn(
  input: SavedSignInInput,
): Promise<{ signedIn: boolean; note?: string }> {
  const { application, settings, platforms, driver, jobId } = input;
  const platform = platformOfAddress(input.url);
  if (platform === undefined || findKnownPlatform(platform) === undefined) {
    return { signedIn: false };
  }
  if (settings.platformLogins[platform] !== "saved") return { signedIn: false };
  const username = platforms.sessions.get(platform)?.username;
  if (username === undefined || !(await platforms.vault.exists(platform, username))) {
    return {
      signedIn: false,
      note: `${platform} is set to saved sign-in, but no credentials are stored. Store them with \`scout login ${platform} --save\`.`,
    };
  }
  application.assertNotPaused();
  input.say(
    `The page needs a sign-in; signing in to ${platform} with the saved credentials (once).`,
  );
  const result = await autoLogin(driver, platform, platforms.vault, platforms.context);
  application.actionLog.append({
    actor: "platforms",
    action: "auto-login",
    jobId,
    detail: result.signedIn
      ? `Signed in to ${platform} with the saved credentials.`
      : `Automatic sign-in to ${platform} stopped: ${result.reason}`,
  });
  if (result.signedIn) return { signedIn: true };
  return { signedIn: false, note: result.reason };
}
