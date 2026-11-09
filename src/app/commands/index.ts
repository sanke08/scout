/** Registers every command on the program. The only file `src/index.ts` needs from this folder. */
import type { Command } from "commander";
import type { ApplicationOptions } from "../application.js";
import { registerApplications } from "./applications.js";
import { registerBoards } from "./boards.js";
import { registerDiscover } from "./discover.js";
import { registerInit } from "./init.js";
import { registerJobs } from "./jobs.js";
import { registerPlatforms } from "./platforms.js";
import { registerProfile } from "./profile.js";
import { registerResume } from "./resume.js";
import { registerServe } from "./serve.js";

/**
 * Adds `init`, `profile`, `resume`, `boards`, `discover`, `jobs`, `digest`, `serve`, `pause`, `unpause`,
 * `platforms`, `login` and `logout`. `overrides` are passed to every `createApplication`; the real program passes none.
 */
export function registerCommands(program: Command, overrides: ApplicationOptions = {}): void {
  registerInit(program, overrides);
  registerProfile(program, overrides);
  registerResume(program, overrides);
  registerBoards(program, overrides);
  registerDiscover(program, overrides);
  registerJobs(program, overrides);
  registerServe(program, overrides);
  registerApplications(program, overrides);
  registerPlatforms(program, overrides);
}
