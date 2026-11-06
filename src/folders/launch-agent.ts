/**
 * The text of a macOS launchd property list that keeps Scout running in the background.
 *
 * Why it exists: IDEA 5.16 wants a background service that starts at login and restarts after a
 * crash. This function only returns the XML text. It never writes to `~/Library/LaunchAgents`
 * and never loads the agent; installing it is a separate step the user approves.
 *
 * The list sets `RunAtLoad` (start at login) and `KeepAlive` (restart after a crash). If
 * `startIntervalSeconds` is given, `StartInterval` is added so launchd also runs it on a timer.
 * Output goes to `scout.out.log` and `scout.err.log` in the log folder.
 *
 * Example: `renderLaunchAgentPlist({ label: "com.example.scout", programArguments: ["/usr/local/bin/node", "/opt/scout/dist/index.js", "run"], workingDirectory: "/opt/scout", logDirectory: "/opt/scout/logs" })`
 * Failure: a label with odd characters, an empty or non-absolute path, an empty argument list,
 * an argument with a control character or a bad interval throws `ScoutError("invalid-input")`.
 */
import { isAbsolute } from "node:path";
import { ScoutError } from "../shared/index.js";

/** What the plist describes. */
export interface LaunchAgentOptions {
  /** Reverse-domain name of the job, for example `com.example.scout`. */
  label: string;
  /** The command and its arguments; the first item is the program, as an absolute path. */
  programArguments: string[];
  workingDirectory: string;
  logDirectory: string;
  /** Also run every this many seconds (launchd `StartInterval`). Left out when not given. */
  startIntervalSeconds?: number;
}

/** Escapes the five characters that have meaning in XML text. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Throws unless `text` has no control characters (they are not allowed in XML text). */
function assertPlainText(text: string, description: string): void {
  if ([...text].some((character) => character.charCodeAt(0) < 32)) {
    throw new ScoutError(
      "invalid-input",
      `The ${description} contains a control character, which a launchd property list cannot hold.`,
    );
  }
}

/** Renders `<key>name</key>` followed by a string value. */
function stringEntry(key: string, value: string): string {
  return `  <key>${escapeXml(key)}</key>\n  <string>${escapeXml(value)}</string>`;
}

/** Returns the property list XML for the background service. */
export function renderLaunchAgentPlist(options: LaunchAgentOptions): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.label)) {
    throw new ScoutError(
      "invalid-input",
      `The service label "${options.label.slice(0, 60)}" may only contain letters, digits, dots, hyphens and underscores, for example com.example.scout.`,
    );
  }
  if (options.programArguments.length === 0) {
    throw new ScoutError(
      "invalid-input",
      "The service needs at least one program argument: the program to run.",
    );
  }
  if (!isAbsolute(options.programArguments[0] as string)) {
    throw new ScoutError(
      "invalid-input",
      "The first program argument must be the absolute path of the program, because launchd does not search your PATH.",
    );
  }
  for (const argument of options.programArguments) {
    assertPlainText(argument, "program argument");
  }
  for (const [description, path] of [
    ["working folder", options.workingDirectory],
    ["log folder", options.logDirectory],
  ] as const) {
    if (!isAbsolute(path)) {
      throw new ScoutError(
        "invalid-input",
        `The ${description} must be an absolute path, but it was "${path.slice(0, 60)}".`,
      );
    }
    assertPlainText(path, description);
  }
  const interval = options.startIntervalSeconds;
  if (interval !== undefined && (!Number.isInteger(interval) || interval < 1)) {
    throw new ScoutError(
      "invalid-input",
      `The start interval must be a whole number of seconds, 1 or more, but it was ${interval}.`,
    );
  }
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    stringEntry("Label", options.label),
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...options.programArguments.map((argument) => `    <string>${escapeXml(argument)}</string>`),
    `  </array>`,
    stringEntry("WorkingDirectory", options.workingDirectory),
    stringEntry("StandardOutPath", `${options.logDirectory.replace(/\/+$/, "")}/scout.out.log`),
    stringEntry("StandardErrorPath", `${options.logDirectory.replace(/\/+$/, "")}/scout.err.log`),
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
  ];
  if (interval !== undefined) {
    lines.push(`  <key>StartInterval</key>`, `  <integer>${interval}</integer>`);
  }
  lines.push(`</dict>`, `</plist>`, ``);
  return lines.join("\n");
}
