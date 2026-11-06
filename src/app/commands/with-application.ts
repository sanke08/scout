/**
 * Runs a command body with an open `Application` and always closes it afterwards.
 *
 * Why it exists: every command needs the same open-run-close routine, and a command that throws
 * must still close the database. Tests pass `overrides` through `main(argv, overrides)` so the
 * real entry point can run with a fake network, a fake brain and a fixed clock.
 *
 * Example: `await withApplication(overrides, async (application) => { console.log(application.directory); })`.
 */
import { createApplication, type Application, type ApplicationOptions } from "../application.js";

/** Opens the application, runs `body`, closes the application, and returns what `body` returned. */
export async function withApplication<T>(
  overrides: ApplicationOptions,
  body: (application: Application) => Promise<T> | T,
): Promise<T> {
  const application = createApplication(overrides);
  try {
    return await body(application);
  } finally {
    application.close();
  }
}
