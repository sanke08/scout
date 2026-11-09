/**
 * The autopilot runner: starts `claude` (Sonnet 5.5) with Scout's tools, watches it, and stops it.
 *
 * Why it exists (D-013): the model decides the whole job hunt; this file only starts it safely,
 * shows what it does and keeps the owner's controls working: the pause switch and the stop button
 * kill the command within two seconds, a turn limit and a time limit bound every run, and every
 * event is summarised in `<data>/agent-runs/` so a run can be read back later (no raw tool
 * answers, no full inputs: see `run-log.ts`). Only one run works on a data folder at a time, across
 * processes (`run-lock.ts`).
 *
 * Example: `const runner = createAgentController(application); runner.start("hunt");` returns at
 * once; `runner.state()` shows the live events; `await runner.done()` gives the `AgentRunResult`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Application } from "../app/application.js";
import { MODEL_NAME } from "../brain/engines.js";
import { writeTextAtomic } from "../folders/index.js";
import { ScoutError } from "../shared/index.js";
import { spawnAgentProcess, type AgentProcess, type AgentSpawner } from "./agent-process.js";
import { createGoalsStore, goalsAreStarter } from "./goals-store.js";
import { buildSystemPrompt, buildTaskPrompt } from "./instructions.js";
import { MAXIMUM_KEPT_RUNS, logLinesFor, pruneRunFiles } from "./run-log.js";
import { acquireRunLock, type RunLock } from "./run-lock.js";
import { oneLine, parseStreamLine } from "./stream-parser.js";
import { decideWebAccess, type WebAccess } from "./web-access.js";
import type {
  AgentController,
  AgentEvent,
  AgentRunResult,
  AgentState,
  AgentTask,
  GoalsStore,
} from "./types.js";

/** The newest events kept in memory for the live log. */
export const MAXIMUM_KEPT_EVENTS = 200;

/** The folder inside the data folder that holds run logs. */
export const RUNS_FOLDER_NAME = "agent-runs";

/** The file inside the runs folder that remembers the last result for other processes. */
export const LAST_RESULT_FILE_NAME = "last-result.json";

/** The tools the model may use without asking: every Scout tool, and the web only as `decideWebAccess` allows. */
const SCOUT_TOOLS_PATTERN = "mcp__scout__*";

/** The mail settings the `scout mcp` child needs. Only the NAMES are ever written to the config. */
export const MAIL_VARIABLE_NAMES = ["SCOUT_IMAP_HOST", "SCOUT_IMAP_USER", "SCOUT_IMAP_PASSWORD"];

/** How the `scout mcp` server is started by the `claude` command. */
export interface McpLaunch {
  command: string;
  args: string[];
}

/** Everything a test may replace. */
export interface AgentControllerOptions {
  /** Starts the command. Default: the real `claude` program. */
  spawner?: AgentSpawner;
  /** The program name. Default: "claude". */
  claudeCommand?: string;
  /** How `scout mcp` is launched. Default: this same Node program and Scout script with `mcp`. */
  mcpLaunch?: McpLaunch;
  /** The goals. Default: `<data>/goals.md`. */
  goalsStore?: GoalsStore;
  /** How often the pause switch and the time limit are checked. Default 2000. */
  pollMilliseconds?: number;
  /** The wall clock in milliseconds for the time limit. Default `Date.now`. */
  wallClock?: () => number;
  /** Master switch for the web tools; false turns them off for every task. Default true (`web-access.ts` says who gets them). */
  allowWeb?: boolean;
  /** The environment the mail variable names are looked up in. Default `process.env`. */
  environment?: Record<string, string | undefined>;
  /** Overrides the `agentMaxTurns` setting (used by the smoke script). */
  maxTurns?: number;
}

/** The controller plus what the command line and tests need beyond the shared interface. */
export interface AgentRunner extends AgentController {
  /** Resolves with the result of the current run (or of the last one); `undefined` if none ever ran. */
  done(): Promise<AgentRunResult | undefined>;
  /** Calls `listener` for every new event. Returns a function that removes it. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

/** The arguments for `claude`, pure so a test can read them. */
export function buildAgentArguments(input: {
  configPath: string;
  maxTurns: number;
  systemPrompt: string;
  web: WebAccess;
}): string[] {
  const webTools: string[] = [];
  const allowed = [SCOUT_TOOLS_PATTERN];
  if (input.web.search) {
    webTools.push("WebSearch");
    allowed.push("WebSearch");
  }
  if (input.web.fetchHosts.length > 0) {
    webTools.push("WebFetch");
    for (const host of input.web.fetchHosts) allowed.push(`WebFetch(domain:${host})`);
  }
  return [
    "-p",
    "--model",
    MODEL_NAME,
    "--mcp-config",
    input.configPath,
    "--strict-mcp-config",
    "--allowedTools",
    allowed.join(","),
    "--tools",
    webTools.join(","),
    "--no-session-persistence",
    "--max-turns",
    String(input.maxTurns),
    "--system-prompt",
    input.systemPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

/** The default launch: this Node program, the same script and loader flags, then `mcp`. */
function defaultMcpLaunch(): McpLaunch {
  const script = process.argv[1];
  return {
    command: process.execPath,
    args: [...process.execArgv, ...(script ? [script] : []), "mcp"],
  };
}

/**
 * The `env` block of the MCP config: the data folder, plus a `${NAME}` reference for each mail
 * variable that is set in the parent. The config holds names, never values, so no secret is
 * written to disk; the `claude` command fills them in when it starts the server. Verified
 * 2026-11-09 with a real `claude -p --mcp-config` call and a tiny server that reported its
 * environment: a variable that the parent did not have under that name arrived with the right
 * value, so the `${NAME}` form does expand (it is not just inheritance).
 * Example: with only SCOUT_IMAP_HOST set: `{ SCOUT_DATA_DIR: "/data", SCOUT_IMAP_HOST: "${SCOUT_IMAP_HOST}" }`.
 */
export function buildMcpEnvironment(
  directory: string,
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const block: Record<string, string> = { SCOUT_DATA_DIR: directory };
  for (const name of MAIL_VARIABLE_NAMES) {
    if (environment[name] !== undefined && environment[name] !== "")
      block[name] = "${" + name + "}";
  }
  return block;
}

/** A file-name-safe time stamp such as `2026-11-09T10-00-00`. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/:/g, "-");
}

/** Reads the last saved result, or undefined when there is none or it is unreadable. */
function readLastResult(directory: string): AgentRunResult | undefined {
  const path = join(directory, RUNS_FOLDER_NAME, LAST_RESULT_FILE_NAME);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentRunResult;
  } catch {
    return undefined;
  }
}

/** The result stored by the last finished run, for `scout agent status`. */
export function loadLastAgentResult(directory: string): AgentRunResult | undefined {
  return readLastResult(directory);
}

/** Builds the runner over an application. One run at a time. */
export function createAgentController(
  application: Application,
  options: AgentControllerOptions = {},
): AgentRunner {
  const spawner = options.spawner ?? spawnAgentProcess;
  const goalsStore = options.goalsStore ?? createGoalsStore(application.directory);
  const pollMilliseconds = options.pollMilliseconds ?? 2000;
  const wallClock = options.wallClock ?? Date.now;
  const runsDirectory = join(application.directory, RUNS_FOLDER_NAME);

  let running = false;
  let lock: RunLock | undefined;
  let currentTask: AgentTask | undefined;
  let startedAt: string | undefined;
  let events: AgentEvent[] = [];
  let last: AgentRunResult | undefined = readLastResult(application.directory);
  let currentProcess: AgentProcess | undefined;
  let stopReason: "stopped" | "paused" | "time" | undefined;
  let pending: Promise<AgentRunResult | undefined> = Promise.resolve(last);
  const listeners = new Set<(event: AgentEvent) => void>();

  const record = (kind: AgentEvent["kind"], summary: string): void => {
    const event: AgentEvent = { at: application.now().toISOString(), kind, summary };
    events.push(event);
    if (events.length > MAXIMUM_KEPT_EVENTS) events = events.slice(-MAXIMUM_KEPT_EVENTS);
    for (const listener of listeners) listener(event);
  };

  /** Starts `claude` and waits for the end. Never throws: every failure becomes a result. */
  const execute = async (
    task: AgentTask,
    instruction: string | undefined,
    web: WebAccess,
  ): Promise<AgentRunResult> => {
    const started = application.now();
    const startedMilliseconds = wallClock();
    const settings = application.settingsStore.load();
    const maxTurns = options.maxTurns ?? settings.agentMaxTurns;
    const runName = `${stamp(started)}-${task}`;
    let toolCalls = 0;
    let turns = 0;
    let final: { success: boolean; text: string; turns: number | undefined } | undefined;
    let timer: NodeJS.Timeout | undefined;

    const finish = (outcome: AgentRunResult["outcome"], summary: string): AgentRunResult => ({
      task,
      startedAt: started.toISOString(),
      finishedAt: application.now().toISOString(),
      outcome,
      summary,
      toolCalls,
      turns: final?.turns ?? turns,
    });

    try {
      mkdirSync(runsDirectory, { recursive: true });
      pruneRunFiles(runsDirectory, MAXIMUM_KEPT_RUNS - 1);
      const logPath = join(runsDirectory, `${runName}.jsonl`);
      const configPath = join(runsDirectory, `${runName}.mcp.json`);
      const launch = options.mcpLaunch ?? defaultMcpLaunch();
      writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            scout: {
              command: launch.command,
              args: launch.args,
              env: buildMcpEnvironment(application.directory, options.environment ?? process.env),
            },
          },
        }),
        { mode: 0o600 },
      );
      const args = buildAgentArguments({
        configPath,
        maxTurns,
        systemPrompt: buildSystemPrompt({ task, goals: goalsStore.load() }),
        web,
      });
      application.actionLog.append({
        actor: "agent",
        action: "run-start",
        detail: `Autopilot ${task} run started (${MODEL_NAME}, at most ${maxTurns} turns).`,
      });
      record("system", `Started the ${task} run (${MODEL_NAME}, at most ${maxTurns} turns).`);

      currentProcess = spawner({
        command: options.claudeCommand ?? "claude",
        args,
        input: buildTaskPrompt(task, instruction),
        onLine(line) {
          for (const logLine of logLinesFor(line)) appendFileSync(logPath, `${logLine}\n`);
          const parsed = parseStreamLine(line);
          toolCalls += parsed.toolCalls;
          if (parsed.turn) turns += 1;
          if (parsed.final) final = parsed.final;
          for (const event of parsed.events) record(event.kind, event.summary);
        },
      });

      timer = setInterval(() => {
        if (stopReason !== undefined) return;
        try {
          if (application.settingsStore.load().automationPaused) {
            stopReason = "paused";
          } else if (wallClock() - startedMilliseconds > settings.agentMaxMinutes * 60_000) {
            stopReason = "time";
          }
        } catch {
          return;
        }
        if (stopReason !== undefined) {
          record(
            "system",
            stopReason === "paused"
              ? "Automation was paused, so the run is being stopped."
              : `The run reached the ${settings.agentMaxMinutes} minute limit and is being stopped.`,
          );
          currentProcess?.kill();
        }
      }, pollMilliseconds);

      const exit = await currentProcess.exited;

      if (stopReason === "stopped" || stopReason === "paused") {
        return finish(
          "stopped",
          stopReason === "paused" ? "Stopped because Scout was paused." : "Stopped by the owner.",
        );
      }
      if (stopReason === "time") {
        return finish("failed", `Stopped after the ${settings.agentMaxMinutes} minute time limit.`);
      }
      if (final !== undefined) {
        return final.success
          ? finish("done", final.text.trim() || "The model finished without a summary.")
          : finish("failed", describeFailure(final.text, maxTurns));
      }
      const reason = exit.errorText.trim()
        ? oneLine(exit.errorText, 400)
        : `The command ended with exit code ${exit.exitCode} and no result.`;
      return finish(
        "failed",
        exit.exitCode === -1 ? reason : `The claude command stopped early. ${reason}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return finish("failed", `The run could not start: ${reason}`);
    } finally {
      if (timer !== undefined) clearInterval(timer);
    }
  };

  return {
    start(task, instruction, startOptions) {
      application.assertNotPaused();
      if (running) {
        throw new ScoutError(
          "invalid-input",
          `An autopilot ${currentTask ?? ""} run is already going. Stop it first, or wait for it to finish.`,
        );
      }
      if (goalsAreStarter(goalsStore.load())) {
        throw new ScoutError(
          "invalid-input",
          "Write your goals first: tell Scout in your own words what jobs you want. Run `scout agent goals --edit FILE` or use the Goals box on the Control page.",
        );
      }
      const web = decideWebAccess({
        task,
        boards: application.boardStore.list(),
        customWanted: startOptions?.web === true,
        allowed: options.allowWeb ?? true,
      });
      lock = acquireRunLock(runsDirectory, application.now().toISOString());
      running = true;
      currentTask = task;
      startedAt = application.now().toISOString();
      events = [];
      stopReason = undefined;
      pending = execute(task, instruction, web).then((result) => {
        last = result;
        running = false;
        lock?.release();
        lock = undefined;
        currentProcess = undefined;
        record("system", `The run ended: ${result.outcome}. ${oneLine(result.summary, 200)}`);
        application.actionLog.append({
          actor: "agent",
          action: "run-end",
          detail: `Autopilot ${result.task} run ${result.outcome}: ${oneLine(result.summary, 200)}`,
        });
        try {
          mkdirSync(runsDirectory, { recursive: true });
          writeTextAtomic(
            join(runsDirectory, LAST_RESULT_FILE_NAME),
            JSON.stringify(result, null, 2),
          );
        } catch {
          // The result is still in memory; a failed save only affects `scout agent status` later.
        }
        return result;
      });
    },
    stop() {
      if (!running || stopReason !== undefined) return;
      stopReason = "stopped";
      record("system", "Stop requested by the owner.");
      currentProcess?.kill();
    },
    state(): AgentState {
      return {
        running,
        ...(currentTask !== undefined && running ? { task: currentTask } : {}),
        ...(startedAt !== undefined && running ? { startedAt } : {}),
        events: [...events],
        ...(last === undefined ? {} : { last }),
      };
    },
    done() {
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Turns the model program's own error word into a sentence for the owner. */
function describeFailure(text: string, maxTurns: number): string {
  if (text.includes("error_max_turns")) {
    return `The run used all ${maxTurns} turns before the model finished. Raise "agentMaxTurns" in settings or give it a smaller job.`;
  }
  if (/not logged in|please run \/login|invalid api key/i.test(text)) {
    return "Claude Code is not signed in. Run `claude` once in a terminal and log in, then start again.";
  }
  return oneLine(text, 400);
}
