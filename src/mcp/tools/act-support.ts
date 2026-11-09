/**
 * What the acting tools share: the way an error becomes a plain sentence for the model, the outside
 * effects they may be given (so tests never touch a real browser, mailbox or keychain), and a few
 * size limits.
 *
 * Why it exists: `tool.ts` says a handler never throws past itself. One wrapper here keeps that
 * true for every acting tool, and keeps secrets and stack traces out of what the model reads.
 *
 * Example: `await safely(() => ok({ done: true }))` returns the success result; if the body throws
 * `ScoutError("paused", "Scout is paused...")` it returns `fail("Scout is paused...")`.
 */
import type { ApplyEnvironmentOverrides } from "../../app/commands/apply-environment.js";
import type { PlatformOverrides } from "../../platforms/index.js";
import { ScoutError } from "../../shared/index.js";
import { fail, type ToolResult } from "../tool.js";

/**
 * What a test (or the server) may replace in the acting tools. The real program passes nothing and
 * gets the real browser, page download, LaTeX and keychain, the same defaults `scout apply` has.
 */
export interface ActToolOptions {
  /** The browser, page download and LaTeX compile (see `ApplyEnvironmentOverrides`). */
  apply?: ApplyEnvironmentOverrides;
  /** The credential vault of the platform sign-in (see `PlatformOverrides`). */
  platforms?: PlatformOverrides;
}

/** The longest job id the tools accept. Real ids are 16 to 64 characters. */
export const JOB_ID_LIMIT = 200;

/** The plain sentence for an error: a `ScoutError` carries its own; anything else gets a safe line. */
export function messageOf(error: unknown): string {
  if (error instanceof ScoutError) return error.message;
  return "Something unexpected went wrong inside Scout, so nothing more was done. Try again, or ask the owner to look at the run log.";
}

/** Runs a handler body and turns any thrown error into an error result. */
export async function safely(run: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    return fail(messageOf(error));
  }
}

/** Cuts text to `limit` characters, adding `...` when something was cut. */
export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3))}...`;
}
