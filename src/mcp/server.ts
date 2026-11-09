/**
 * The MCP server that offers Scout's tools to the model.
 *
 * Why it exists: in autopilot the `claude` command (Sonnet 5.5) is started with `--mcp-config`
 * pointing at `scout mcp`. That command runs this server over standard input and output. Every
 * tool in `ALL_TOOLS` becomes one MCP tool: the model reads its description, sends input that is
 * checked against the tool's zod schema, and gets back JSON text.
 *
 * Rules kept here for every tool: a handler that throws becomes an error result (never a crash of
 * the server); a result with `ok: false` is flagged `isError`; the pause check is handed to the
 * handler through the context; every call is noted in the action log without its input.
 *
 * Example: `await serveScoutMcp(application)` runs until the `claude` command closes the pipe and
 * the calls still running have finished.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Application } from "../app/application.js";
import type { ScoutTool, ToolContext, ToolResult } from "./tool.js";
import { ALL_TOOLS } from "./tools/index.js";

/** The server name the model sees; tool names appear as `mcp__scout__<tool>`. */
export const MCP_SERVER_NAME = "scout";

/** Turns a tool result into the MCP shape: one JSON text block, `isError` when it failed. */
function toCallResult(result: ToolResult): CallToolResult {
  if (result.ok) {
    return { content: [{ type: "text", text: JSON.stringify(result.data ?? null) }] };
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
  };
}

/** Runs one tool and never throws: a thrown error becomes an error result with its message. */
async function runTool(tool: ScoutTool, input: unknown, context: ToolContext): Promise<ToolResult> {
  try {
    return await tool.handler(input, context);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  }
}

/** How long a stop waits for calls that are still running (a submit in progress), in milliseconds. */
export const DRAIN_MILLISECONDS = 60_000;

/** What `createScoutMcpService` returns: the server and the way to stop it gracefully. */
export interface ScoutMcpService {
  server: McpServer;
  /** True once `shutdown` has begun; new calls are refused and tools check it before irreversible steps. */
  isStopping(): boolean;
  /**
   * Stops accepting calls and waits (at most `drainMilliseconds`) for the calls that are running,
   * so a submit that already wrote its marker still records its outcome. Resolves `true` when
   * nothing is running any more, `false` when the wait ran out.
   */
  shutdown(): Promise<boolean>;
}

/** Options of `createScoutMcpService`; tests shorten the wait. */
export interface ScoutMcpServiceOptions {
  drainMilliseconds?: number;
}

/**
 * Builds the server with the given tools registered (default: all of Scout's tools), together with
 * its graceful shutdown. It is not connected to anything yet; call `server.connect` with a
 * transport. Tests pass their own tool list.
 */
export function createScoutMcpService(
  application: Application,
  tools: readonly ScoutTool[] = ALL_TOOLS,
  options: ScoutMcpServiceOptions = {},
): ScoutMcpService {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" });
  const running = new Set<Promise<unknown>>();
  let stopping = false;
  const context: ToolContext = {
    application,
    assertNotPaused: () => application.assertNotPaused(),
    note: (line) => {
      application.actionLog.append({ actor: "agent", action: "tool-note", detail: line });
    },
    isStopping: () => stopping,
  };
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      },
      async (input: unknown) => {
        if (stopping) {
          return toCallResult({
            ok: false,
            error: "Scout is stopping, so this call was not run and nothing was changed.",
          });
        }
        const call = runTool(tool, input, context);
        running.add(call);
        try {
          const result = await call;
          context.note(
            `${tool.name}: ${result.ok ? "ok" : `error: ${result.error.slice(0, 200)}`}`,
          );
          return toCallResult(result);
        } finally {
          running.delete(call);
        }
      },
    );
  }
  return {
    server,
    isStopping: () => stopping,
    async shutdown() {
      stopping = true;
      if (running.size === 0) return true;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), options.drainMilliseconds ?? DRAIN_MILLISECONDS);
      });
      const finished = Promise.allSettled([...running]).then(() => true as const);
      const drained = await Promise.race([finished, timedOut]);
      clearTimeout(timer);
      return drained;
    },
  };
}

/** Builds just the server (see `createScoutMcpService`). Kept for callers and tests that need nothing more. */
export function createScoutMcpServer(
  application: Application,
  tools: readonly ScoutTool[] = ALL_TOOLS,
): McpServer {
  return createScoutMcpService(application, tools).server;
}

/** What `serveScoutMcp` may be given; tests replace the exit. */
export interface ServeOptions extends ScoutMcpServiceOptions {
  /** Ends the process when a running call did not finish in time. Default: `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * Serves the tools on standard input and output until the other side closes. Standard output is
 * the protocol channel, so nothing else may print to it; log to standard error only.
 *
 * Stopping (the input closes, or SIGTERM/SIGINT arrives because the run was stopped): no new call
 * is accepted, calls that are running are waited for (a minute at most) and only then is the
 * server closed, so the caller closes the database after the last handler, never under one. When a
 * call outlives the wait the process ends without closing the database (SQLite recovers), and
 * the job stays `submitting`, which Scout never retries.
 */
export async function serveScoutMcp(
  application: Application,
  options: ServeOptions = {},
): Promise<void> {
  const service = createScoutMcpService(application, ALL_TOOLS, options);
  await service.server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    service.server.server.onclose = resolve;
    let stopRequested = false;
    const stop = (): void => {
      if (stopRequested) return;
      stopRequested = true;
      void service.shutdown().then(async (drained) => {
        if (!drained) {
          process.stderr.write("Scout stopped while a call was still running.\n");
          (options.exit ?? process.exit)(1);
          return;
        }
        await service.server.close();
      });
    };
    // The transport does not notice a closed input pipe, so end the server ourselves.
    process.stdin.on("end", stop);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}
