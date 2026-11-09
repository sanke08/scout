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
 * Example: `await serveScoutMcp(application)` runs until the `claude` command closes the pipe.
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

/**
 * Builds the server with the given tools registered (default: all of Scout's tools). It is not
 * connected to anything yet; call `connect` with a transport. Tests pass their own tool list.
 */
export function createScoutMcpServer(
  application: Application,
  tools: readonly ScoutTool[] = ALL_TOOLS,
): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" });
  const context: ToolContext = {
    application,
    assertNotPaused: () => application.assertNotPaused(),
    note: (line) => {
      application.actionLog.append({ actor: "agent", action: "tool-note", detail: line });
    },
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
        const result = await runTool(tool, input, context);
        context.note(`${tool.name}: ${result.ok ? "ok" : `error: ${result.error.slice(0, 200)}`}`);
        return toCallResult(result);
      },
    );
  }
  return server;
}

/**
 * Serves the tools on standard input and output until the other side closes. Standard output is
 * the protocol channel, so nothing else may print to it; log to standard error only.
 */
export async function serveScoutMcp(application: Application): Promise<void> {
  const server = createScoutMcpServer(application);
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
    // The transport does not notice a closed input pipe, so end the server ourselves.
    process.stdin.on("end", () => void server.close());
  });
}
