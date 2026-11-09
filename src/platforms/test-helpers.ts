/**
 * Helpers for the platforms tests: fictional sign-in pages and a fake website that behaves like a
 * platform's sign-in plus an application form behind it.
 *
 * Why: the sign-in rules (own domain only, once, stop at CAPTCHA) must be tested with no browser
 * and no network. `createFakeSite` remembers everything typed into it, so a test can say what a
 * hostile page did and did not receive. Everything is fictional (example.com, Alex Rivera, a
 * made-up password string).
 *
 * Only test files import this file; it is not part of the public interface.
 */
import type { BrowserDriver } from "../apply/index.js";
import { createFakeDriver } from "../apply/fake-driver.js";

/** The made-up password every test stores. It must never appear in any output. */
export const FAKE_PASSWORD = "not-a-real-password";

/** A plain one-step sign-in page. */
export const LOGIN_PAGE_HTML = `<html><body><h1>Sign in</h1>
<form action="/login-submit" method="post">
  <input type="text" name="session_key" autocomplete="username" placeholder="Email or phone">
  <input type="password" name="session_password" placeholder="Password">
  <button type="submit">Sign in</button>
</form></body></html>`;

/** A sign-in page that asks for the email only (the password comes on a second page). */
export const TWO_STEP_PAGE_HTML = `<html><body><form>
  <input type="email" name="email"><button type="submit">Continue</button>
</form></body></html>`;

/** What the site does after the sign-in form is sent. */
export type SignInOutcome =
  "accepted" | "wrong-password" | "captcha" | "one-time-code" | "checkpoint";

/** Settings for the fake site. */
export interface FakeSiteOptions {
  /** The application form behind the wall. */
  applicationHtml: string;
  /** What happens after the sign-in is sent. Default `accepted`. */
  outcome?: SignInOutcome;
  /** The address the sign-in page really ends up on (a redirect to another site). Default: the address opened. */
  signInRedirectsTo?: string;
  /** Replaces the sign-in page HTML (for example a two-step page). */
  signInHtml?: string;
  /** Starts with a valid session, so the application opens without a wall. */
  alreadySignedIn?: boolean;
  /** Replaces the text of the sign-in page (for example a CAPTCHA wall). */
  signInText?: string;
}

/** The fake site plus a record of what was done to it. */
export interface FakeSite extends BrowserDriver {
  /** One line per call, `fill`, `submit` and `open` included (values are never in these lines). */
  readonly calls: string[];
  /** Everything typed into the sign-in page: the selector and the value. */
  readonly typed: { selector: string; value: string }[];
  /** How many times the sign-in form was sent. */
  signInSubmits(): number;
  /** True when the sign-in was accepted. */
  isSignedIn(): boolean;
}

/** True when the address is a sign-in address of one of the three platforms. */
function isSignInAddress(address: string): boolean {
  return /\/(login|auth|nlogin)/.test(address);
}

/** Builds the fake site described in the file comment. */
export function createFakeSite(options: FakeSiteOptions): FakeSite {
  const application = createFakeDriver({ html: options.applicationHtml });
  const calls: string[] = [];
  const typed: { selector: string; value: string }[] = [];
  let signedIn = options.alreadySignedIn === true;
  let submits = 0;
  let address = "";
  let page: "sign-in" | "wall" | "application" | "after-sign-in" = "wall";
  const signInHtml = options.signInHtml ?? LOGIN_PAGE_HTML;

  const afterText = (): string => {
    switch (options.outcome ?? "accepted") {
      case "accepted":
        return "Welcome back, Alex Rivera. Here is your feed.";
      case "wrong-password":
        return "That password is not right. Sign in to your account.";
      case "captcha":
        return "Security check. Please complete the captcha to continue.";
      case "one-time-code":
        return "We sent a verification code to your email. Enter the code.";
      case "checkpoint":
        return "Let's do a quick security check: please verify it's you.";
    }
  };

  return {
    calls,
    typed,
    signInSubmits: () => submits,
    isSignedIn: () => signedIn,
    async open(url) {
      calls.push(`open ${url}`);
      address = isSignInAddress(url) ? (options.signInRedirectsTo ?? url) : url;
      if (isSignInAddress(url)) page = "sign-in";
      else if (signedIn) {
        page = "application";
        await application.open(url);
      } else page = "wall";
    },
    async currentUrl() {
      return address;
    },
    async pageText() {
      calls.push("pageText");
      if (page === "sign-in") return options.signInText ?? "Sign in Email Password";
      if (page === "wall") return "Please sign in to continue to your account.";
      if (page === "after-sign-in") return afterText();
      return application.pageText();
    },
    async pageHtml() {
      calls.push("pageHtml");
      if (page === "sign-in") return signInHtml;
      if (page === "wall") return `<html><body><form><input type="password"></form></body></html>`;
      if (page === "after-sign-in") {
        return options.outcome === "wrong-password" ? signInHtml : "<html><body>ok</body></html>";
      }
      return application.pageHtml();
    },
    async fill(selector, value) {
      calls.push(`fill ${selector}`);
      if (page === "sign-in" || page === "after-sign-in") {
        typed.push({ selector, value });
        return;
      }
      await application.fill(selector, value);
    },
    async submit(selector) {
      calls.push(`submit ${selector}`);
      if (page === "sign-in") {
        submits += 1;
        signedIn = (options.outcome ?? "accepted") === "accepted";
        page = "after-sign-in";
        return;
      }
      await application.submit(selector);
    },
    select: (selector, value) => application.select(selector, value),
    upload: (selector, filePath) => application.upload(selector, filePath),
    readValue: (selector) => application.readValue(selector),
    screenshot: () => application.screenshot(),
    readConfirmation: () => application.readConfirmation(),
    async close() {
      calls.push("close");
    },
  };
}
