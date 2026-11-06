/**
 * Reads the mailbox credentials from the environment, and nowhere else.
 *
 * Why it exists: Scout never stores the mail password. The user keeps it in their own secure
 * place and gives it to one run through three environment variables. An app-specific password
 * is recommended (one the mail provider lets you revoke), not the main account password. On
 * macOS it can be taken from the Keychain: `security find-generic-password -s scout-imap -w`.
 *
 * Example: with `SCOUT_IMAP_HOST=imap.example.com`, `SCOUT_IMAP_USER=alex@example.com` and
 * `SCOUT_IMAP_PASSWORD=app-password` set, the result is `{ host, user, password }`. An empty or
 * missing variable counts as missing. The error names the variables, never a value.
 */
import { ScoutError } from "../../shared/index.js";
import type { ImapCredentials } from "../../tracking/index.js";

/** The environment variable that holds the mail server address, e.g. `imap.example.com`. */
export const IMAP_HOST_VARIABLE = "SCOUT_IMAP_HOST";

/** The environment variable that holds the mail account name, e.g. `alex@example.com`. */
export const IMAP_USER_VARIABLE = "SCOUT_IMAP_USER";

/** The environment variable that holds the (app-specific) mail password. Never printed or stored. */
export const IMAP_PASSWORD_VARIABLE = "SCOUT_IMAP_PASSWORD";

/** Reads one variable; an empty or blank value counts as not set. */
function readVariable(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = environment[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * Returns the credentials from the environment.
 * Failure: when any variable is missing, a `ScoutError("invalid-input")` lists the missing names
 * and says how to set them.
 */
export function readMailCredentials(
  environment: Readonly<Record<string, string | undefined>>,
): ImapCredentials {
  const host = readVariable(environment, IMAP_HOST_VARIABLE);
  const user = readVariable(environment, IMAP_USER_VARIABLE);
  const password = readVariable(environment, IMAP_PASSWORD_VARIABLE);
  const missing = [
    [IMAP_HOST_VARIABLE, host],
    [IMAP_USER_VARIABLE, user],
    [IMAP_PASSWORD_VARIABLE, password],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (host === undefined || user === undefined || password === undefined) {
    throw new ScoutError(
      "invalid-input",
      `Scout needs three environment variables to read your mail, and these are not set: ${missing.join(", ")}. ` +
        `Set ${IMAP_HOST_VARIABLE} (for example imap.example.com), ${IMAP_USER_VARIABLE} (your mail account) and ${IMAP_PASSWORD_VARIABLE} in your shell before running the command. ` +
        "Use an app-specific password, not your main one. On macOS you can take it from the Keychain with: " +
        `export ${IMAP_PASSWORD_VARIABLE}="$(security find-generic-password -s scout-imap -w)". Scout never stores or prints this password.`,
    );
  }
  return { host, user, password };
}
