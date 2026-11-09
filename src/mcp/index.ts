/** Public surface of the MCP module. Other modules import only from here. */
export { MCP_SERVER_NAME, createScoutMcpServer, serveScoutMcp } from "./server.js";
export { fail, ok } from "./tool.js";
export type { ScoutTool, ToolContext, ToolResult } from "./tool.js";
export { ALL_TOOLS } from "./tools/index.js";
