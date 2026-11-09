/**
 * The shape of one tool Scout offers to the model, and the rules every tool follows.
 *
 * Why it exists: in autopilot the model (Sonnet 5.5) decides what to do and Scout only does the
 * mechanical work when asked. Each capability is a `ScoutTool`: a name, a plain description the
 * model reads, a zod schema for its input, and a handler. The registry in `tools/index.ts` lists
 * them all; `server.ts` turns the list into an MCP server for the `claude` command.
 *
 * Rules every handler keeps (these protect the user's data and controls; they are not filters on
 * what the model may choose to pursue):
 * - Call `context.assertNotPaused()` first when the tool fetches, fills, submits or reads mail.
 *   When the user has paused Scout the tool answers with an error result and does nothing.
 * - Text that came from outside (a posting, an email, a web page) is returned inside a field named
 *   `untrustedText`, never mixed into instructions.
 * - Never return or log a secret (password, mail password, token).
 * - A failure is returned as an error result with a plain sentence the model can act on; it is
 *   never thrown past the handler.
 * - A handler changes state only through the existing stores (job store, ledger, profile store),
 *   so every rule that protects data (state machine, submitted-once, fact check) still applies.
 */
import type { z } from "zod";
import type { Application } from "../app/application.js";

/** What a tool returns to the model. `data` is turned into JSON text. */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

/** What a handler may use. */
export interface ToolContext {
  application: Application;
  /** Throws a ScoutError("paused") when the kill switch is on; tools turn that into an error result. */
  assertNotPaused(): void;
  /** Writes one line to the agent run log (tool name, short argument summary, outcome). */
  note(line: string): void;
}

/** One capability offered to the model. */
export interface ScoutTool<Input extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Lower-case words and underscores, for example `record_decision`. The model sees it as `mcp__scout__record_decision`. */
  name: string;
  /** Plain words: what it does, when to use it, what it returns. This is the model's manual. */
  description: string;
  inputSchema: Input;
  /** True when the tool only reads and never changes anything. */
  readOnly: boolean;
  handler(input: z.infer<Input>, context: ToolContext): Promise<ToolResult> | ToolResult;
}

/** Builds a success result. */
export function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

/** Builds an error result with a sentence the model can act on. */
export function fail(error: string): ToolResult {
  return { ok: false, error };
}
