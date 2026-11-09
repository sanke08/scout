/**
 * The few things every platform sign-in step needs, gathered once: the vault, the sign-in record
 * and the context the login flows take.
 *
 * Why it exists: `scout platforms`, `scout login`, `scout logout` and `scout apply` all open the
 * same record file and use the same vault and keyboard. One builder keeps them identical.
 *
 * Example: `platformServices(application, environment, vault).sessions.get("linkedin")`.
 */
import { join } from "node:path";
import {
  createSessionStore,
  type CredentialVault,
  type LoginContext,
  type SessionStore,
} from "../../platforms/index.js";
import type { Application } from "../application.js";
import type { ApplyEnvironment } from "./apply-environment.js";

/** The name of the record file inside the data folder. */
export const PLATFORM_SESSIONS_FILE = "platform-sessions.json";

/** What the platform steps share. */
export interface PlatformServices {
  vault: CredentialVault;
  sessions: SessionStore;
  context: LoginContext;
}

/** Builds the services for one command run. */
export function platformServices(
  application: Application,
  environment: ApplyEnvironment,
  vault: CredentialVault,
): PlatformServices {
  const sessions = createSessionStore(join(application.directory, PLATFORM_SESSIONS_FILE));
  return {
    vault,
    sessions,
    context: {
      sessions,
      now: () => application.now(),
      readLine: environment.readLine,
      pause: environment.pause,
    },
  };
}
