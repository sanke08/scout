/**
 * The real browser driver, built on `playwright-core`.
 *
 * HONEST STATUS: this file has NOT been run against a real browser. The test suite cannot start
 * one (no browser, no network, no accounts), so everything that decides behaviour is tested
 * through the `BrowserDriver` interface with a fake. This adapter is a thin translation of that
 * interface into Playwright calls and must be tried by hand on a fictional or test form before
 * it is trusted.
 *
 * It is loaded lazily (see `playwright-loader.ts`) so that importing the apply module never
 * loads Playwright. It launches a persistent browser profile in a dedicated folder, shown on
 * screen by default so the user can watch and take over. It never handles credentials itself: a
 * sign-in wall is detected from the page text; only the platforms module (with the user's saved
 * choice) ever asks it to type one, through the plain `fill` call.
 *
 * Example: `const driver = await launchPlaywrightDriver({ profileDirectory: "/data/browser-profile" })`.
 */
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { ScoutError } from "../shared/index.js";
import type { BrowserDriver } from "./driver.js";

/** Options for the real browser. */
export interface PlaywrightDriverOptions {
  /** Folder that holds this browser profile (cookies, sessions). Dedicated to Scout; never the user's own profile. */
  profileDirectory: string;
  /** Run without a visible window. Default false: the window is shown. */
  headless?: boolean;
  /** Path of a browser program to use, when Playwright's own download is not installed. */
  executablePath?: string;
}

/** How long one page action may take before it fails (30 seconds). A failure stops the run. */
const ACTION_TIMEOUT_MS = 30_000;

/** Runs in the page: reads what a field (or radio group) currently holds, as `BrowserDriver.readValue` describes. */
function readFieldInPage(selector: string): string {
  const elements = Array.from(document.querySelectorAll(selector)) as HTMLInputElement[];
  const first = elements[0];
  if (first === undefined) return "";
  const labelOf = (element: HTMLInputElement): string => {
    const wrapping = element.closest("label");
    const explicit =
      element.id === "" ? null : document.querySelector(`label[for="${element.id}"]`);
    const label = wrapping ?? explicit;
    return (label?.textContent ?? element.value).replace(/\s+/g, " ").trim();
  };
  if (first.tagName === "SELECT") {
    const select = first as unknown as HTMLSelectElement;
    return select.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  if (first.type === "radio") {
    const checked = elements.find((element) => element.checked);
    return checked === undefined ? "" : labelOf(checked);
  }
  if (first.type === "checkbox" && elements.length === 1) return first.checked ? "true" : "false";
  if (first.type === "file") return first.files?.[0]?.name ?? "";
  return first.value;
}

/** Runs in the page: chooses a radio option by its text, or sets a single tick box. Returns false when nothing matched. */
function chooseInPage(arguments_: { selector: string; value: string }): boolean {
  const elements = Array.from(document.querySelectorAll(arguments_.selector)) as HTMLInputElement[];
  const textOf = (element: HTMLInputElement): string => {
    const wrapping = element.closest("label");
    const explicit =
      element.id === "" ? null : document.querySelector(`label[for="${element.id}"]`);
    return ((wrapping ?? explicit)?.textContent ?? element.value).replace(/\s+/g, " ").trim();
  };
  if (elements.length === 1 && elements[0]?.type === "checkbox") {
    const box = elements[0];
    if (box.checked !== (arguments_.value === "true")) box.click();
    return true;
  }
  const target = elements.find((element) => textOf(element) === arguments_.value);
  if (target === undefined) return false;
  if (!target.checked) target.click();
  return true;
}

/** Wraps a Playwright page in the `BrowserDriver` interface. */
function wrapPage(context: BrowserContext, page: Page): BrowserDriver {
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  return {
    async open(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    async currentUrl() {
      return page.url();
    },
    async pageText() {
      return page.innerText("body");
    },
    async pageHtml() {
      return page.content();
    },
    async fill(selector, value) {
      await page.fill(selector, value);
    },
    async select(selector, value) {
      const tag = await page
        .locator(selector)
        .first()
        .evaluate((element) => element.tagName);
      if (tag === "SELECT") {
        await page.selectOption(selector, { label: value });
        return;
      }
      const chosen = await page.evaluate(chooseInPage, { selector, value });
      if (!chosen) {
        throw new ScoutError("unavailable", `The page has no choice "${value}" for ${selector}.`);
      }
    },
    async upload(selector, filePath) {
      await page.setInputFiles(selector, filePath);
    },
    async readValue(selector) {
      return page.evaluate(readFieldInPage, selector);
    },
    async screenshot() {
      return page.screenshot({ fullPage: true, type: "png" });
    },
    async submit(selector) {
      await page.click(selector);
    },
    async readConfirmation() {
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2_000);
      return page.innerText("body");
    },
    async close() {
      await context.close();
    },
  };
}

/** Starts the persistent browser and returns the driver. Throws a `ScoutError` when no browser can start. */
export async function launchPlaywrightDriver(
  options: PlaywrightDriverOptions,
): Promise<BrowserDriver> {
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(options.profileDirectory, {
      headless: options.headless ?? false,
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ScoutError(
      "unavailable",
      `Scout could not start the browser (${detail}). Install a browser for Playwright or give the path of one, then try again.`,
    );
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return wrapPage(context, page);
}
