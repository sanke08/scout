/**
 * Loads the real browser driver only when it is asked for.
 *
 * Why: importing `playwright-core` is slow and needs a browser to be useful. Keeping it behind a
 * dynamic import means tests, the CLI's other commands and this module's public index never load
 * it. See `playwright-driver.ts` for the honest note that it is untested against a real browser.
 *
 * Example: `const driver = await createPlaywrightDriver({ profileDirectory })`.
 */
import type { BrowserDriver } from "./driver.js";
import type { PlaywrightDriverOptions } from "./playwright-driver.js";

/** Launches the persistent-profile browser driver; the Playwright code is loaded on this call. */
export async function createPlaywrightDriver(
  options: PlaywrightDriverOptions,
): Promise<BrowserDriver> {
  const { launchPlaywrightDriver } = await import("./playwright-driver.js");
  return launchPlaywrightDriver(options);
}
