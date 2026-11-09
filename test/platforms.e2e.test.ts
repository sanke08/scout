/**
 * End-to-end tests of `scout platforms`, `scout platforms set`, `scout login`, `scout logout` and
 * the automatic sign-in inside `scout apply`, through the real `main(argv, overrides)` with a fake
 * vault (no keychain), a fake website (no browser, no network) and a typed-line stand-in.
 *
 * What must stay true: sign-in is manual unless the user chose "saved" for that platform; Scout
 * signs in at most once per run and per six hours, only on the platform's own domain, and stops at
 * a CAPTCHA or any extra step; the password never appears in any output, log, evidence file or
 * record; risky choices need the platform name typed; a paused Scout never opens a browser or types.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeVault, type FakeVault } from "../src/platforms/fake-vault.js";
import {
  FAKE_PASSWORD,
  createFakeSite,
  type FakeSite,
  type FakeSiteOptions,
} from "../src/platforms/test-helpers.js";
import { formHtml } from "../src/apply/test-helpers.js";
import { createSettingsStore } from "../src/store/index.js";
import { makeApplyWorld, type ApplyWorld, type ApplyWorldOptions } from "./apply-helpers.js";
import type { CliResult } from "./helpers.js";

const worlds: ApplyWorld[] = [];
afterEach(() => {
  while (worlds.length > 0) worlds.pop()?.remove();
});

/** The fictional application address on LinkedIn used by the apply tests. */
const LINKEDIN_APPLY_URL = "https://www.linkedin.com/jobs/view/123/apply";

/** Settings that let `scout apply` fill the form on the greenhouse board. */
const FILL_WITH_SAVED_LOGIN = {
  boardLevels: { greenhouse: "fill" as const },
  platformLogins: { linkedin: "saved" as const },
};

/** Everything one test works with. */
interface Setup {
  made: ApplyWorld;
  vault: FakeVault;
  site: FakeSite;
  run: (args: string[]) => Promise<CliResult>;
}

/** Builds a world whose browser is a fake site and whose vault holds one fictional credential. */
function setup(
  options: ApplyWorldOptions = {},
  siteOptions: Partial<FakeSiteOptions> = {},
  vaultOptions: { stored?: boolean; supported?: boolean } = {},
): Setup {
  const site = createFakeSite({ applicationHtml: formHtml("greenhouse-style"), ...siteOptions });
  const vault = createFakeVault({
    supported: vaultOptions.supported ?? true,
    stored:
      vaultOptions.stored === false
        ? {}
        : { linkedin: { username: "alex@example.com", password: FAKE_PASSWORD } },
  });
  const made = makeApplyWorld({ ...options, wrapDriver: () => site });
  worlds.push(made);
  if (vaultOptions.stored !== false) {
    writeFileSync(
      join(made.directory, "platform-sessions.json"),
      JSON.stringify({
        schemaVersion: 1,
        platforms: { linkedin: { username: "alex@example.com" } },
      }),
    );
  }
  return { made, vault, site, run: (args) => made.run(args, { platforms: { vault } }) };
}

/** Every line a run printed, as one text. */
function allOutput(result: CliResult): string {
  return [...result.lines, ...result.errors].join("\n");
}

/** The status of the one test job. */
function statusOf(made: ApplyWorld): string | undefined {
  return made.inspect((application) => application.jobStore.get("job-1")?.status);
}

/** Lists every file under a folder. */
function filesUnder(folder: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** The files under the data folder that contain the fake password. */
function filesHoldingPassword(directory: string): string[] {
  return filesUnder(directory).filter((path) =>
    readFileSync(path).includes(Buffer.from(FAKE_PASSWORD)),
  );
}

describe("settings", () => {
  it("loads a settings file written before platformLogins existed, with no platform set to saved", () => {
    const { made } = setup();
    writeFileSync(
      join(made.directory, "old-settings.json"),
      JSON.stringify({ dailyApplicationLimit: 3 }),
    );
    const loaded = createSettingsStore(join(made.directory, "old-settings.json")).load();
    expect(loaded.dailyApplicationLimit).toBe(3);
    expect(loaded.platformLogins).toEqual({});
  });
});

describe("scout platforms", () => {
  it("lists the known platforms as manual, nothing saved, never signed in, Prepare only", async () => {
    const { run } = setup({}, {}, { stored: false });
    const result = await run(["platforms"]);
    const text = allOutput(result);
    expect(result.exitCode).toBe(0);
    for (const name of ["linkedin", "indeed", "naukri"]) expect(text).toContain(name);
    const linkedin = result.lines.find((line) => line.startsWith("linkedin"))!;
    expect(linkedin).toMatch(/manual\s+no\s+never\s+Prepare only/);
  });

  it("shows saved credentials, the chosen way, the last sign-in and the level after a change", async () => {
    const { run, made } = setup();
    await run(["platforms", "set", "linkedin", "--level", "fill"]);
    const sessionsPath = join(made.directory, "platform-sessions.json");
    writeFileSync(
      sessionsPath,
      JSON.stringify({
        schemaVersion: 1,
        platforms: {
          linkedin: { username: "alex@example.com", lastManualLoginAt: "2026-11-08T09:30:00.000Z" },
        },
      }),
    );
    const linkedin = (await run(["platforms"])).lines.find((line) => line.startsWith("linkedin"))!;
    expect(linkedin).toMatch(/manual\s+yes\s+2026-11-08 09:30\s+Fill, I submit/);
  });

  it("never prints the username's password, whatever it shows", async () => {
    const { run } = setup();
    expect(allOutput(await run(["platforms"]))).not.toContain(FAKE_PASSWORD);
  });
});

describe("scout platforms set", () => {
  it("needs the platform name typed before it turns on saved sign-in, and changes nothing on any other answer", async () => {
    const { run, made } = setup({ typedLines: ["yes", "linkedin"] });
    const refused = await run(["platforms", "set", "linkedin", "--login", "saved"]);
    expect(allOutput(refused)).toMatch(/terms/);
    expect(allOutput(refused)).toMatch(/Not confirmed/);
    expect(made.inspect((app) => app.settingsStore.load().platformLogins)).toEqual({});

    const accepted = await run(["platforms", "set", "linkedin", "--login", "saved"]);
    expect(accepted.exitCode).toBe(0);
    expect(made.inspect((app) => app.settingsStore.load().platformLogins)).toEqual({
      linkedin: "saved",
    });
  });

  it("asks the same for level auto on a known platform and writes the level", async () => {
    const { run, made } = setup({ typedLines: ["indeed"] });
    const result = await run(["platforms", "set", "indeed", "--level", "auto"]);
    expect(allOutput(result)).toMatch(/risk|restricted/);
    expect(made.inspect((app) => app.settingsStore.load().boardLevels.indeed)).toBe("auto");
  });

  it("changes a safe choice without a warning, and can switch back to manual at any time", async () => {
    const { run, made } = setup({ typedLines: ["linkedin"] });
    await run(["platforms", "set", "linkedin", "--login", "saved"]);
    const back = await run([
      "platforms",
      "set",
      "linkedin",
      "--login",
      "manual",
      "--level",
      "prepare",
    ]);
    expect(allOutput(back)).not.toMatch(/terms/);
    expect(made.inspect((app) => app.settingsStore.load().platformLogins.linkedin)).toBe("manual");
    const other = await run(["platforms", "set", "example", "--level", "fill"]);
    expect(allOutput(other)).not.toMatch(/terms/);
  });

  it("refuses an empty change, a bad value, saved on an unknown platform and saved without a keychain", async () => {
    const { run } = setup();
    expect((await run(["platforms", "set", "linkedin"])).exitCode).toBe(2);
    expect((await run(["platforms", "set", "linkedin", "--login", "maybe"])).exitCode).toBe(2);
    expect((await run(["platforms", "set", "example", "--login", "saved"])).exitCode).toBe(2);
    const noKeychain = setup({}, {}, { supported: false });
    const result = await noKeychain.run(["platforms", "set", "linkedin", "--login", "saved"]);
    expect(result.exitCode).toBe(6);
    expect(allOutput(result)).toMatch(/Manual sign-in still works/);
  });
});

describe("scout login and logout", () => {
  it("opens the platform's sign-in page in Scout's own profile and records that the user signed in", async () => {
    const { run, made, site } = setup({ typedLines: [""] });
    const result = await run(["login", "linkedin"]);
    expect(result.exitCode).toBe(0);
    expect(made.browserOpens).toEqual([
      { profileDirectory: join(made.directory, "browser-profile"), headless: false },
    ]);
    expect(site.calls[0]).toBe("open https://www.linkedin.com/login");
    expect(site.typed).toEqual([]);
    const record = JSON.parse(readFileSync(join(made.directory, "platform-sessions.json"), "utf8"));
    expect(record.platforms.linkedin.lastManualLoginAt).toBe("2026-11-07T10:00:00.000Z");
  });

  it("with --save asks for the username only, lets the vault store the password, and writes no password anywhere", async () => {
    const { run, made, vault } = setup(
      { typedLines: ["alex@example.com", ""] },
      {},
      { stored: false },
    );
    const result = await run(["login", "linkedin", "--save"]);
    expect(result.exitCode).toBe(0);
    expect(made.prompts[0]).toMatch(/Username or email/);
    expect(made.prompts[0]).toMatch(/not the password/);
    expect(vault.saves).toEqual(["linkedin"]);
    const record = JSON.parse(readFileSync(join(made.directory, "platform-sessions.json"), "utf8"));
    expect(record.platforms.linkedin.username).toBe("alex@example.com");
    expect(filesHoldingPassword(made.directory)).toEqual([]);
    const table = (await run(["platforms"])).lines.find((line) => line.startsWith("linkedin"))!;
    expect(table).toMatch(/manual\s+yes/);
  });

  it("refuses --save for an unknown platform and when the system has no keychain", async () => {
    const { run, made } = setup({}, {}, { stored: false });
    expect((await run(["login", "example", "--save"])).exitCode).toBe(2);
    const noKeychain = setup({}, {}, { supported: false, stored: false });
    const result = await noKeychain.run(["login", "linkedin", "--save"]);
    expect(result.exitCode).toBe(6);
    expect(made.browserOpens).toHaveLength(0);
    expect(noKeychain.made.browserOpens).toHaveLength(0);
  });

  it("opens no browser and types nothing while Scout is paused", async () => {
    const { run, made, site, vault } = setup({ settings: { automationPaused: true } });
    const result = await run(["login", "linkedin", "--save"]);
    expect(result.exitCode).toBe(7);
    expect(made.browserOpens).toHaveLength(0);
    expect(site.calls).toEqual([]);
    expect(vault.saves).toEqual([]);
  });

  it("logout clears the sign-in note, and --forget deletes the keychain item and the username", async () => {
    const { run, made, vault } = setup({ typedLines: [""] });
    await run(["login", "linkedin"]);
    const plain = await run(["logout", "linkedin"]);
    expect(plain.exitCode).toBe(0);
    expect(vault.forgets).toEqual([]);
    let record = JSON.parse(readFileSync(join(made.directory, "platform-sessions.json"), "utf8"));
    expect(record.platforms.linkedin.lastManualLoginAt).toBeUndefined();
    expect(record.platforms.linkedin.username).toBe("alex@example.com");

    const forgotten = await run(["logout", "linkedin", "--forget"]);
    expect(forgotten.exitCode).toBe(0);
    expect(vault.forgets).toEqual(["linkedin"]);
    record = JSON.parse(readFileSync(join(made.directory, "platform-sessions.json"), "utf8"));
    expect(record.platforms.linkedin).toBeUndefined();
  });
});

describe("scout apply at a sign-in wall", () => {
  it("with the default manual way never types a credential, and names the exact command", async () => {
    const { run, made, site, vault } = setup({
      settings: { boardLevels: { greenhouse: "fill" } },
      typedLines: [""],
    });
    const result = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(statusOf(made)).toBe("needs-you");
    expect(allOutput(result)).toContain("scout login linkedin");
    expect(allOutput(result)).toMatch(/Sign in yourself in the open browser window/);
    expect(site.typed).toEqual([]);
    expect(vault.reads).toEqual([]);
  });

  it("with saved credentials signs in once, re-opens the application and fills the form", async () => {
    const { run, made, site, vault } = setup({ settings: FILL_WITH_SAVED_LOGIN });
    const result = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL, "--wait", "0"]);
    expect(result.exitCode).toBe(0);
    expect(site.signInSubmits()).toBe(1);
    expect(vault.reads).toEqual(["linkedin"]);
    const opens = site.calls.filter((call) => call.startsWith("open "));
    expect(opens.slice(0, 3)).toEqual([
      `open ${LINKEDIN_APPLY_URL}`,
      "open https://www.linkedin.com/login",
      `open ${LINKEDIN_APPLY_URL}`,
    ]);
    expect(site.calls.filter((call) => call.startsWith("fill ")).length).toBeGreaterThan(2);
    expect(statusOf(made)).not.toBe("needs-you");
    expect(
      site.calls.some((call) => call.startsWith("submit #") || call.includes("submit_app")),
    ).toBe(false);
  });

  it("never lets the password reach any output, log, evidence file, record or settings file", async () => {
    const { run, made, site } = setup({ settings: FILL_WITH_SAVED_LOGIN });
    const first = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL, "--wait", "0"]);
    const second = await setup({ settings: FILL_WITH_SAVED_LOGIN }, { outcome: "captcha" });
    const failed = await second.run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    // The control: the password really was typed into the page, so the scan below proves something.
    expect(site.typed.map((entry) => entry.value)).toContain(FAKE_PASSWORD);
    for (const result of [first, failed]) expect(allOutput(result)).not.toContain(FAKE_PASSWORD);
    expect(made.inspect((app) => JSON.stringify(app.actionLog.recent(500)))).not.toContain(
      FAKE_PASSWORD,
    );
    expect(filesHoldingPassword(made.directory)).toEqual([]);
    expect(filesHoldingPassword(second.made.directory)).toEqual([]);
  });

  it("stops at a CAPTCHA after the one attempt, and does not try again within six hours", async () => {
    const { run, made, site } = setup(
      { settings: FILL_WITH_SAVED_LOGIN, typedLines: ["", ""] },
      { outcome: "captcha" },
    );
    const first = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(statusOf(made)).toBe("needs-you");
    expect(site.signInSubmits()).toBe(1);
    expect(allOutput(first)).toMatch(/scout login linkedin/);
    expect(allOutput(first)).toMatch(/CAPTCHA|captcha/);

    await run(["undo", "job-1"]);
    const second = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(site.signInSubmits()).toBe(1);
    expect(statusOf(made)).toBe("needs-you");
    expect(allOutput(second)).toMatch(/six hours/);
  });

  it("types nothing when the sign-in page ends up on another site", async () => {
    const { run, made, site, vault } = setup(
      { settings: FILL_WITH_SAVED_LOGIN, typedLines: [""] },
      { signInRedirectsTo: "https://accounts.evil.example.net/login" },
    );
    const result = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(site.typed).toEqual([]);
    expect(vault.reads).toEqual([]);
    expect(statusOf(made)).toBe("needs-you");
    expect(allOutput(result)).toMatch(/not on linkedin\.com/);
  });

  it("says so when saved sign-in is chosen but no credentials are stored, and types nothing", async () => {
    const { run, site } = setup(
      { settings: FILL_WITH_SAVED_LOGIN, typedLines: [""] },
      {},
      { stored: false },
    );
    const result = await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(site.typed).toEqual([]);
    expect(allOutput(result)).toMatch(/scout login linkedin --save/);
  });

  it("opens no browser at level Prepare, whatever the sign-in way", async () => {
    const { run, made, site } = setup({
      settings: { boardLevels: { greenhouse: "prepare" }, platformLogins: { linkedin: "saved" } },
    });
    await run(["apply", "job-1", "--url", LINKEDIN_APPLY_URL]);
    expect(made.browserOpens).toHaveLength(0);
    expect(site.typed).toEqual([]);
  });
});
