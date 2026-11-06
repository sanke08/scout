/**
 * Registers the mail, notes and interview commands in one call, so `src/index.ts` needs a single
 * line for them: `inbox`, `followups`, `funnel`, `notes` and `interview`.
 */
import type { Command } from "commander";
import type { ApplicationOptions } from "../application.js";
import { registerFollowUps } from "./mail-followups.js";
import { registerInbox } from "./mail-inbox.js";
import { registerInterview } from "./notes-interview.js";
import { registerNotes } from "./notes-write.js";

/** Adds `inbox`, `followups`, `funnel`, `notes write|list|draft` and `interview`. */
export function registerMailAndNotesCommands(
  program: Command,
  overrides: ApplicationOptions = {},
): void {
  registerInbox(program, overrides);
  registerFollowUps(program, overrides);
  registerNotes(program, overrides);
  registerInterview(program, overrides);
}
