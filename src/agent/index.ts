/** Public surface of the agent module. Other modules import only from here. */
export { AGENT_TASKS } from "./types.js";
export type {
  AgentController,
  AgentEvent,
  AgentRunResult,
  AgentStartOptions,
  AgentState,
  AgentTask,
  GoalsStore,
} from "./types.js";
export {
  GOALS_FILE_NAME,
  MAXIMUM_GOALS_CHARACTERS,
  STARTER_GOALS,
  createGoalsStore,
  goalsAreStarter,
} from "./goals-store.js";
export {
  buildAgentArguments,
  createAgentController,
  loadLastAgentResult,
  type AgentControllerOptions,
  type AgentRunner,
  type McpLaunch,
} from "./run-agent.js";
export type { AgentProcess, AgentProcessRequest, AgentSpawner } from "./agent-process.js";
export { buildSystemPrompt, buildTaskPrompt } from "./instructions.js";
