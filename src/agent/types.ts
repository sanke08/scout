/**
 * The shapes shared by the autopilot runner, the command line and the web page.
 *
 * Why it exists: the runner starts the `claude` command (Sonnet 5.5) with Scout's tools and reports
 * what the model is doing. The Control tab shows it live. The three sides agree on these types.
 */

/** What kind of pass the user starts. The model decides the steps inside it. */
export const AGENT_TASKS = ["hunt", "inbox", "followups", "custom"] as const;

/** One kind of autopilot pass. */
export type AgentTask = (typeof AGENT_TASKS)[number];

/** One line of the live log. */
export interface AgentEvent {
  /** ISO time. */
  at: string;
  /** `text`: the model said something. `tool`: it called a Scout tool. `result`: a tool answered. `system`: start, stop, pause. */
  kind: "text" | "tool" | "result" | "system";
  /** One line in plain words, already shortened and free of secrets. */
  summary: string;
}

/** How a finished run ended. */
export interface AgentRunResult {
  task: AgentTask;
  startedAt: string;
  finishedAt: string;
  /** `done`: the model finished. `stopped`: the user pressed stop or pause. `failed`: the command or a limit failed. */
  outcome: "done" | "stopped" | "failed";
  /** The model's closing summary, or the reason for a failure. */
  summary: string;
  /** Tool calls made. */
  toolCalls: number;
  /** Model turns used. */
  turns: number;
}

/** What the page and the command line read. */
export interface AgentState {
  running: boolean;
  task?: AgentTask;
  startedAt?: string;
  /** The newest events, oldest first, at most 200. */
  events: AgentEvent[];
  last?: AgentRunResult;
}

/** Starts, stops and reports autopilot runs. One run at a time. */
export interface AgentController {
  /**
   * Starts a run in the background and returns at once. `instruction` is extra text from the user
   * for a `custom` task or a note for any task.
   * Failure: a ScoutError("paused") when paused, ("invalid-input") when a run is already going.
   */
  start(task: AgentTask, instruction?: string): void;
  /** Stops the current run (kills the `claude` process). Safe when nothing runs. */
  stop(): void;
  state(): AgentState;
}

/** The user's standing wishes in their own words: what jobs, where, what to avoid, how to behave. */
export interface GoalsStore {
  /** The saved text, or the starter text when none was saved. */
  load(): string;
  save(text: string): void;
}
