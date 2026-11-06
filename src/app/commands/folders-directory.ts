/**
 * Finds the data folder for commands that must not open the application.
 *
 * Why it exists: opening the application creates the folder and its database, which would make a
 * restore into a fresh folder always look "not empty", and would be pointless for printing a
 * service file. Those commands only need the folder's path.
 *
 * Example: `resolveDataFolder({ directory: "/tmp/scout" })` is `/tmp/scout`; with no override it is
 * the usual `SCOUT_DATA_DIR`, else `./data`.
 */
import { resolve } from "node:path";
import { dataDirectory } from "../../shared/index.js";
import type { ApplicationOptions } from "../application.js";

/** The absolute path of the data folder, honouring a test override. */
export function resolveDataFolder(overrides: ApplicationOptions): string {
  return overrides.directory === undefined ? dataDirectory() : resolve(overrides.directory);
}
