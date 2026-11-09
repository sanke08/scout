import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formHtml } from "../apply/test-helpers.js";
import { createFakeVault } from "./fake-vault.js";
import { findLoginForm } from "./form-finder.js";
import {
  AUTO_LOGIN_WAIT_MILLISECONDS,
  autoLogin,
  manualLogin,
  type LoginContext,
} from "./login.js";
import { createSessionStore } from "./session-store.js";
import {
  FAKE_PASSWORD,
  LOGIN_PAGE_HTML,
  TWO_STEP_PAGE_HTML,
  createFakeSite,
  type FakeSiteOptions,
} from "./test-helpers.js";

const folders: string[] = [];
afterEach(() => {
  while (folders.length > 0) rmSync(folders.pop()!, { recursive: true, force: true });
});

const START = new Date("2026-11-09T10:00:00.000Z");

/** A context with a movable clock, a real session file in a temporary folder, and typed lines. */
function setup(typed: string[] = [""]) {
  const folder = mkdtempSync(join(tmpdir(), "scout-login-"));
  folders.push(folder);
  const sessions = createSessionStore(join(folder, "platform-sessions.json"));
  const clock = { now: START };
  const prompts: string[] = [];
  const context: LoginContext = {
    sessions,
    now: () => clock.now,
    readLine: async (prompt) => {
      prompts.push(prompt);
      return typed.shift() ?? "";
    },
    pause: async () => {},
  };
  sessions.update("linkedin", { username: "alex@example.com" });
  const vault = createFakeVault({
    stored: { linkedin: { username: "alex@example.com", password: FAKE_PASSWORD } },
  });
  return { sessions, clock, context, vault, prompts };
}

/** A site with the saved fictional form behind its wall. */
function site(options: Partial<FakeSiteOptions> = {}) {
  return createFakeSite({ applicationHtml: formHtml("greenhouse-style"), ...options });
}

describe("manualLogin", () => {
  it("opens the platform's own sign-in page, types nothing, and records the time after Enter", async () => {
    const { context, sessions, prompts } = setup();
    const driver = site();
    await manualLogin(driver, "linkedin", context);
    expect(driver.calls[0]).toBe("open https://www.linkedin.com/login");
    expect(driver.typed).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(sessions.get("linkedin")?.lastManualLoginAt).toBe(START.toISOString());
  });

  it("needs an address for a platform it does not know, and opens that address", async () => {
    const { context } = setup();
    await expect(manualLogin(site(), "example", context)).rejects.toThrow(/--url/);
    const driver = site();
    await manualLogin(driver, "example", context, "https://example.com/login");
    expect(driver.calls[0]).toBe("open https://example.com/login");
  });
});

describe("autoLogin", () => {
  it("types the credentials once on the platform's own page and records the success", async () => {
    const { context, sessions, vault } = setup();
    const driver = site();
    const result = await autoLogin(driver, "linkedin", vault, context);
    expect(result).toEqual({ signedIn: true });
    expect(driver.signInSubmits()).toBe(1);
    expect(driver.typed).toEqual([
      { selector: 'input[name="session_key"]', value: "alex@example.com" },
      { selector: 'input[name="session_password"]', value: FAKE_PASSWORD },
    ]);
    expect(sessions.get("linkedin")?.lastAutoLoginAt).toBe(START.toISOString());
    expect(sessions.get("linkedin")?.lastAutoLoginFailedAt).toBeUndefined();
  });

  it("types nothing, and never even reads the password, on a page of another domain", async () => {
    const { context, vault, sessions } = setup();
    const driver = site({ signInRedirectsTo: "https://login.evil.example.net/linkedin" });
    const result = await autoLogin(driver, "linkedin", vault, context);
    expect(result.signedIn).toBe(false);
    expect(driver.typed).toEqual([]);
    expect(driver.calls.some((call) => call.startsWith("fill") || call.startsWith("submit"))).toBe(
      false,
    );
    expect(vault.reads).toEqual([]);
    expect(sessions.get("linkedin")?.lastAutoLoginFailedAt).toBeUndefined();
  });

  it("types nothing on a look-alike host or a plain http page", async () => {
    for (const address of [
      "https://linkedin.com.example.net/login",
      "http://www.linkedin.com/login",
    ]) {
      const { context, vault } = setup();
      const driver = site({ signInRedirectsTo: address });
      expect((await autoLogin(driver, "linkedin", vault, context)).signedIn).toBe(false);
      expect(driver.typed).toEqual([]);
    }
  });

  it.each(["captcha", "one-time-code", "checkpoint", "wrong-password"] as const)(
    "stops after one try when the site answers with %s, records it and tells the user to finish by hand",
    async (outcome) => {
      const { context, vault, sessions } = setup();
      const driver = site({ outcome });
      const result = await autoLogin(driver, "linkedin", vault, context);
      expect(result.signedIn).toBe(false);
      if (!result.signedIn) expect(result.reason).toMatch(/scout login linkedin/);
      expect(driver.signInSubmits()).toBe(1);
      expect(sessions.get("linkedin")?.lastAutoLoginFailedAt).toBe(START.toISOString());
      expect(sessions.get("linkedin")?.lastAutoLoginAt).toBeUndefined();
    },
  );

  it("refuses to run again inside six hours, after a failure or a success, and runs again after", async () => {
    const { context, vault, clock } = setup();
    await autoLogin(site({ outcome: "wrong-password" }), "linkedin", vault, context);
    clock.now = new Date(START.getTime() + AUTO_LOGIN_WAIT_MILLISECONDS - 1000);
    const second = site();
    const refused = await autoLogin(second, "linkedin", vault, context);
    expect(refused.signedIn).toBe(false);
    expect(second.calls).toEqual([]);
    clock.now = new Date(START.getTime() + AUTO_LOGIN_WAIT_MILLISECONDS);
    const third = site();
    expect(await autoLogin(third, "linkedin", vault, context)).toEqual({ signedIn: true });
    clock.now = new Date(clock.now.getTime() + 60_000);
    const fourth = site();
    expect((await autoLogin(fourth, "linkedin", vault, context)).signedIn).toBe(false);
    expect(fourth.calls).toEqual([]);
  });

  it("does not type when the page is a CAPTCHA wall or has no plain form", async () => {
    const wall = setup();
    const walled = site({ signInText: "Please complete the captcha security check" });
    expect((await autoLogin(walled, "linkedin", wall.vault, wall.context)).signedIn).toBe(false);
    expect(walled.typed).toEqual([]);

    const steps = setup();
    const twoStep = site({ signInHtml: TWO_STEP_PAGE_HTML });
    expect((await autoLogin(twoStep, "linkedin", steps.vault, steps.context)).signedIn).toBe(false);
    expect(twoStep.typed).toEqual([]);
  });

  it("does nothing without stored credentials or for a platform it does not know", async () => {
    const { context } = setup();
    const empty = createFakeVault();
    const driver = site();
    expect((await autoLogin(driver, "linkedin", empty, context)).signedIn).toBe(false);
    expect(driver.calls).toEqual([]);
    await expect(autoLogin(driver, "example", empty, context)).rejects.toThrow(/known platforms/);
  });

  it("never puts the password in a result or a stored record", async () => {
    const { context, vault, sessions } = setup();
    const driver = site({ outcome: "captcha" });
    const result = await autoLogin(driver, "linkedin", vault, context);
    expect(JSON.stringify(result)).not.toContain(FAKE_PASSWORD);
    expect(JSON.stringify(sessions.list())).not.toContain(FAKE_PASSWORD);
    expect(driver.calls.join("\n")).not.toContain(FAKE_PASSWORD);
  });
});

describe("findLoginForm", () => {
  it("finds the username box, the password box and the button of a plain form", () => {
    expect(findLoginForm(LOGIN_PAGE_HTML)).toEqual({
      usernameSelector: 'input[name="session_key"]',
      passwordSelector: 'input[name="session_password"]',
      submitSelector: 'form button[type="submit"]',
    });
  });

  it("answers nothing when the page is unclear", () => {
    expect(findLoginForm(TWO_STEP_PAGE_HTML)).toBeUndefined();
    expect(findLoginForm("<html><body>Hello</body></html>")).toBeUndefined();
    const twoPasswords = LOGIN_PAGE_HTML.replace(
      "<button",
      '<input type="password" name="again"><button',
    );
    expect(findLoginForm(twoPasswords)).toBeUndefined();
  });
});
