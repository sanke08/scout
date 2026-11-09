/**
 * `scout platforms`, `scout platforms set`, `scout login` and `scout logout`: the owner's control
 * over how Scout signs in to each platform and how far it goes there.
 *
 * Why they exist: some sites need a sign-in before an application can be opened. The user picks,
 * per platform, whether to sign in by hand ("manual", the default, the saved browser session is
 * reused) or to let Scout use credentials kept in the operating system's keychain ("saved"), and
 * the apply level (prepare, fill, auto). Either choice can be changed or undone at any time.
 * Nothing here submits an application. Credentials are never printed, logged or put in a file.
 */
import { join } from "node:path";
import type { Command } from "commander";
import {
  AUTOMATION_WARNING,
  KNOWN_PLATFORMS,
  applyPlatformChoice,
  assertSavedLoginPossible,
  confirmationMatches,
  describePlatformChoice,
  findKnownPlatform,
  isRiskyPlatformChoice,
  latestSignIn,
  manualLogin,
  normalisePlatformName,
  resolveVault,
  type CredentialVault,
  type PlatformChoice,
} from "../../platforms/index.js";
import { ScoutError, boardLevelSchema, platformLoginSchema } from "../../shared/index.js";
import type { Application, ApplicationOptions } from "../application.js";
import { LEVEL_NAMES } from "./apply-preparation.js";
import { resolveApplyEnvironment, type ApplyEnvironment } from "./apply-environment.js";
import { platformServices, type PlatformServices } from "./platform-services.js";
import { withApplication } from "./with-application.js";

/** The options of `scout platforms set`. */
interface SetOptions {
  login?: string;
  level?: string;
}

/** The options of `scout login`. */
interface LoginOptions {
  save?: boolean;
  url?: string;
}

/** The options of `scout logout`. */
interface LogoutOptions {
  forget?: boolean;
}

/** Formats an ISO time as `2026-11-09 10:00`, or `never`. */
function describeTime(iso: string | undefined): string {
  if (iso === undefined) return "never";
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? "never" : iso.slice(0, 16).replace("T", " ");
}

/** Pads text on the right to a column width. */
function column(text: string, width: number): string {
  return text.padEnd(width);
}

/** Prints the table of `scout platforms`. */
async function printPlatforms(application: Application, services: PlatformServices): Promise<void> {
  const settings = application.settingsStore.load();
  const sessions = services.sessions.list();
  const names = new Set<string>(KNOWN_PLATFORMS.map((platform) => platform.name));
  for (const name of Object.keys(settings.platformLogins)) names.add(name);
  for (const name of Object.keys(sessions)) names.add(name);

  const rows: string[][] = [
    ["Platform", "Login way", "Credentials saved", "Last sign-in", "Apply level"],
  ];
  for (const name of [...names].sort()) {
    const session = sessions[name];
    const username = session?.username;
    let saved: string;
    if (!services.vault.isSupported()) saved = "no keychain here";
    else if (username === undefined) saved = "no";
    else saved = (await services.vault.exists(name, username)) ? "yes" : "no";
    const lastSignIn = latestSignIn(session);
    rows.push([
      name,
      settings.platformLogins[name] ?? "manual",
      saved,
      describeTime(lastSignIn),
      LEVEL_NAMES[settings.boardLevels[name] ?? "prepare"],
    ]);
  }
  const widths = rows[0]!.map((_cell, index) =>
    Math.max(...rows.map((row) => (row[index] ?? "").length)),
  );
  for (const row of rows) {
    console.log(
      row
        .map((cell, index) => column(cell, widths[index] ?? 0))
        .join("  ")
        .trimEnd(),
    );
  }
  console.log("");
  console.log(
    "Change a platform with `scout platforms set <platform> --login manual|saved --level prepare|fill|auto`.",
  );
}

/** Parses `--login` and `--level` into validated values. Failure: `ScoutError("invalid-input")`. */
function parseSetOptions(options: SetOptions): PlatformChoice {
  if (options.login === undefined && options.level === undefined) {
    throw new ScoutError(
      "invalid-input",
      "Nothing to change. Give --login manual|saved, --level prepare|fill|auto, or both.",
    );
  }
  const parsed: PlatformChoice = {};
  if (options.login !== undefined) {
    const login = platformLoginSchema.safeParse(options.login);
    if (!login.success) {
      throw new ScoutError(
        "invalid-input",
        `--login must be one of: ${platformLoginSchema.options.join(", ")}.`,
      );
    }
    parsed.login = login.data;
  }
  if (options.level !== undefined) {
    const level = boardLevelSchema.safeParse(options.level);
    if (!level.success) {
      throw new ScoutError(
        "invalid-input",
        `--level must be one of: ${boardLevelSchema.options.join(", ")}.`,
      );
    }
    parsed.level = level.data;
  }
  return parsed;
}

/**
 * For a known sign-in platform and a risky choice, shows the warning and requires the platform
 * name to be typed. Returns false (and says nothing changed) for any other answer.
 */
async function confirmRisk(
  environment: ApplyEnvironment,
  platform: string,
  choice: PlatformChoice,
): Promise<boolean> {
  if (!isRiskyPlatformChoice(platform, choice)) return true;
  console.log(AUTOMATION_WARNING);
  const answer = await environment.readLine(
    `Type the platform name (${platform}) to confirm, anything else cancels: `,
  );
  if (confirmationMatches(platform, answer)) return true;
  console.log("Not confirmed. Nothing was changed.");
  return false;
}

/** `scout platforms set`: writes the choice into the settings. */
async function runSet(
  application: Application,
  environment: ApplyEnvironment,
  vault: CredentialVault,
  platformText: string,
  options: SetOptions,
): Promise<void> {
  const platform = normalisePlatformName(platformText);
  const choice = parseSetOptions(options);
  assertSavedLoginPossible(platform, choice, vault);
  if (!(await confirmRisk(environment, platform, choice))) return;

  application.settingsStore.save(
    applyPlatformChoice(application.settingsStore.load(), platform, choice),
  );
  application.actionLog.append({
    actor: "platforms",
    action: "platform-settings-changed",
    detail: describePlatformChoice(platform, choice),
  });
  if (choice.login !== undefined) console.log(`${platform}: sign-in way is now ${choice.login}.`);
  if (choice.level !== undefined) {
    console.log(`${platform}: apply level is now ${LEVEL_NAMES[choice.level]}.`);
  }
  if (choice.login === "saved") {
    console.log(
      `Store the credentials with \`scout login ${platform} --save\`. Until then Scout falls back to manual sign-in.`,
    );
  }
}

/** Checks a typed username: one non-empty line. Failure: `ScoutError("invalid-input")`. */
function parseUsername(text: string): string {
  const username = text.trim();
  if (username === "") {
    throw new ScoutError("invalid-input", "No username was given, so nothing was saved.");
  }
  return username;
}

/** `scout login`: optional credential saving, then the manual sign-in window. */
async function runLogin(
  application: Application,
  environment: ApplyEnvironment,
  services: PlatformServices,
  platformText: string,
  options: LoginOptions,
): Promise<void> {
  application.assertNotPaused();
  const platform = normalisePlatformName(platformText);
  if (options.save === true) {
    if (findKnownPlatform(platform) === undefined) {
      throw new ScoutError(
        "invalid-input",
        `Credentials can be saved only for linkedin, indeed and naukri, not "${platform}".`,
      );
    }
    if (!services.vault.isSupported()) {
      throw new ScoutError(
        "unavailable",
        "Credentials cannot be saved on this computer (no keychain Scout knows). Manual sign-in still works: run `scout login " +
          platform +
          "` without --save.",
      );
    }
    const username = parseUsername(
      await environment.readLine(`Username or email for ${platform} (not the password): `),
    );
    console.log(
      "Next the keychain program asks for the password itself. Scout never sees or stores it.",
    );
    await services.vault.save(platform, username);
    services.sessions.update(platform, { username });
    application.actionLog.append({
      actor: "platforms",
      action: "credentials-saved",
      detail: `Credentials for ${platform} were stored in the keychain.`,
    });
    console.log(
      `Saved in the keychain. To let Scout use them: scout platforms set ${platform} --login saved`,
    );
  }
  const driver = await environment.openBrowser({
    profileDirectory: join(application.directory, "browser-profile"),
    headless: false,
  });
  try {
    await manualLogin(driver, platform, services.context, options.url);
  } finally {
    try {
      await driver.close();
    } catch {
      // The window may already be gone.
    }
  }
  application.actionLog.append({
    actor: "platforms",
    action: "manual-login",
    detail: `The user signed in to ${platform} by hand.`,
  });
  console.log(
    `Recorded your sign-in to ${platform}. The session stays in Scout's own browser profile.`,
  );
}

/** `scout logout`: clears the sign-in note, and with --forget the keychain item. */
async function runLogout(
  application: Application,
  services: PlatformServices,
  platformText: string,
  options: LogoutOptions,
): Promise<void> {
  const platform = normalisePlatformName(platformText);
  services.sessions.clearSignIns(platform);
  console.log(`Cleared Scout's note of your sign-ins to ${platform}.`);
  if (options.forget === true) {
    const username = services.sessions.get(platform)?.username;
    const removed = await services.vault.forget(platform, username);
    services.sessions.remove(platform);
    application.actionLog.append({
      actor: "platforms",
      action: "credentials-forgotten",
      detail: `Saved credentials for ${platform} ${removed ? "were deleted from" : "were not found in"} the keychain.`,
    });
    console.log(
      removed
        ? `Deleted the saved credentials for ${platform} from the keychain.`
        : `No saved credentials for ${platform} were found in the keychain.`,
    );
  }
  console.log(
    `The browser session itself lives in ${join(application.directory, "browser-profile")}. Sign out inside the browser window, or delete that folder, to remove it.`,
  );
}

/** Adds `platforms`, `platforms set`, `login` and `logout`. */
export function registerPlatforms(program: Command, overrides: ApplicationOptions): void {
  const environment = resolveApplyEnvironment(overrides.apply);
  const vault = resolveVault(overrides.platforms);

  const platforms = program
    .command("platforms")
    .description("Show, per platform, how Scout signs in and how far it goes.")
    .action(() =>
      withApplication(overrides, (application) =>
        printPlatforms(application, platformServices(application, environment, vault)),
      ),
    );

  platforms
    .command("set")
    .description("Choose the sign-in way and/or the apply level of a platform.")
    .argument("<platform>", "for example linkedin, indeed or naukri")
    .option("--login <way>", "manual (you sign in) or saved (Scout uses the keychain)")
    .option("--level <level>", "prepare, fill or auto")
    .action((platform: string, options: SetOptions) =>
      withApplication(overrides, (application) =>
        runSet(application, environment, vault, platform, options),
      ),
    );

  program
    .command("login")
    .description("Open a platform's sign-in page so you can sign in yourself.")
    .argument("<platform>", "for example linkedin, indeed or naukri")
    .option("--save", "also store the username and password in the keychain")
    .option("--url <address>", "the sign-in page, needed only for a platform Scout does not know")
    .action((platform: string, options: LoginOptions) =>
      withApplication(overrides, (application) =>
        runLogin(
          application,
          environment,
          platformServices(application, environment, vault),
          platform,
          options,
        ),
      ),
    );

  program
    .command("logout")
    .description("Forget Scout's note of your sign-ins, and optionally the saved credentials.")
    .argument("<platform>", "for example linkedin, indeed or naukri")
    .option("--forget", "also delete the saved credentials from the keychain")
    .action((platform: string, options: LogoutOptions) =>
      withApplication(overrides, (application) =>
        runLogout(
          application,
          platformServices(application, environment, vault),
          platform,
          options,
        ),
      ),
    );
}
