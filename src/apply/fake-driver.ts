/**
 * A browser driver that works on saved HTML instead of a real browser, for tests only.
 *
 * Why: the rules in this module must be tested with no browser, no network and no accounts. The
 * fake keeps field values in memory, checks that every selector exists in the saved page and
 * that a chosen option really is one of the page's options, and records every call so tests can
 * say what was (and was not) touched.
 *
 * Example: `const driver = createFakeDriver({ html, confirmationText: "Thank you for applying!" })`;
 * after a run, `driver.calls` holds lines such as `"submit #submit_app"`.
 * Only test files import this file; it is not part of the public interface.
 */
import { basename } from "node:path";
import * as cheerio from "cheerio";
import type { BrowserDriver } from "./driver.js";

/** Settings for the fake. Everything but `html` is optional. */
export interface FakeDriverOptions {
  /** The saved application page. */
  html: string;
  /** Text the page shows after the submit. Default: a normal confirmation. */
  confirmationText?: string;
  /** Replaces the visible page text (to simulate a CAPTCHA wall, for example). Default: the HTML's text. */
  pageText?: string;
  /** Field selector to a value the page "reformats" the typed value into, to simulate a mismatch. */
  corruptions?: Record<string, string>;
  /** When true, `submit` throws after being recorded (a crash during the click). */
  submitThrows?: boolean;
  /** The address `currentUrl` reports after an open (to simulate a redirect). Default: the address opened. */
  currentUrl?: string;
  /** When true, `open` throws. */
  openThrows?: boolean;
}

/** The fake plus the log of everything done to it. */
export interface FakeDriver extends BrowserDriver {
  /** One line per call, for example `"fill [name=\"email\"]"`. Reads are not recorded except `readValue`. */
  readonly calls: string[];
  /** The values currently held, by selector. */
  readonly values: Map<string, string>;
}

/** Creates the fake described in the file comment. */
export function createFakeDriver(options: FakeDriverOptions): FakeDriver {
  const $ = cheerio.load(options.html);
  const calls: string[] = [];
  const values = new Map<string, string>();
  let submitted = false;
  let openedUrl = "";

  const find = (selector: string) => {
    const matches = $(selector);
    if (matches.length === 0) throw new Error(`No element matches ${selector} in the saved page.`);
    return matches;
  };

  const driver: FakeDriver = {
    calls,
    values,
    async open(url) {
      calls.push(`open ${url}`);
      openedUrl = url;
      if (options.openThrows === true) throw new Error("The page could not be opened.");
    },
    async currentUrl() {
      return options.currentUrl ?? openedUrl;
    },
    async pageText() {
      calls.push("pageText");
      return options.pageText ?? $("body").text().replace(/\s+/g, " ").trim();
    },
    async pageHtml() {
      calls.push("pageHtml");
      return options.html;
    },
    async fill(selector, value) {
      calls.push(`fill ${selector}`);
      find(selector);
      values.set(selector, options.corruptions?.[selector] ?? value);
    },
    async select(selector, value) {
      calls.push(`select ${selector}`);
      const matches = find(selector);
      const first = matches.first();
      const tag = first.prop("tagName")?.toString().toLowerCase();
      const type = (first.attr("type") ?? "").toLowerCase();
      if (tag === "input" && type === "checkbox" && matches.length === 1) {
        values.set(selector, options.corruptions?.[selector] ?? value);
        return;
      }
      const labels: string[] = [];
      if (tag === "select") {
        first.find("option").each((_index, node) => {
          labels.push($(node).text().trim());
        });
      } else {
        matches.each((_index, node) => {
          const wrapping = $(node).closest("label").text().trim();
          labels.push(wrapping !== "" ? wrapping : ($(node).attr("value") ?? ""));
        });
      }
      if (!labels.includes(value)) throw new Error(`"${value}" is not an option of ${selector}.`);
      values.set(selector, options.corruptions?.[selector] ?? value);
    },
    async upload(selector, filePath) {
      calls.push(`upload ${selector}`);
      const element = find(selector).first();
      if ((element.attr("type") ?? "").toLowerCase() !== "file") {
        throw new Error(`${selector} is not a file input.`);
      }
      values.set(selector, options.corruptions?.[selector] ?? basename(filePath));
    },
    async readValue(selector) {
      calls.push(`readValue ${selector}`);
      find(selector);
      return values.get(selector) ?? "";
    },
    async screenshot() {
      calls.push("screenshot");
      return new Uint8Array([137, 80, 78, 71]);
    },
    async submit(selector) {
      calls.push(`submit ${selector}`);
      find(selector);
      submitted = true;
      if (options.submitThrows === true) throw new Error("The browser crashed during the click.");
    },
    async readConfirmation() {
      calls.push("readConfirmation");
      if (!submitted) return "";
      return (
        options.confirmationText ?? "Thank you for applying! Your application has been received."
      );
    },
    async close() {
      calls.push("close");
    },
  };
  return driver;
}
