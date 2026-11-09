/**
 * A fake `claude` command for tests: it prints canned stream-json lines and never starts a real
 * program. Only test files and the smoke script's tests import this file.
 *
 * Example: `fakeClaude({ lines: [assistantToolUse("get_profile"), successResult("Done.")] })` is an
 * `AgentSpawner`; `.requests` lists what the runner asked it to start.
 */
import type { AgentProcessExit, AgentProcessRequest, AgentSpawner } from "./agent-process.js";

/** What the fake should do. */
export interface FakeClaudeScript {
  /** Lines printed in order. */
  lines: string[];
  /** When true the command never ends by itself; it ends only when killed. */
  hang?: boolean;
  /** The exit it reports when it ends by itself. Default `{ exitCode: 0, errorText: "" }`. */
  exit?: AgentProcessExit;
  /** When true the command could not be started (exit code -1). */
  cannotStart?: string;
}

/** The fake plus what it saw. */
export interface FakeClaude {
  spawner: AgentSpawner;
  requests: AgentProcessRequest[];
  kills: number;
}

/** A line where the model calls one Scout tool. */
export function assistantToolUse(name: string, input: unknown = {}): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: `mcp__scout__${name}`, input }] },
  });
}

/** A line where the model says something. */
export function assistantText(text: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
}

/** A line where a tool answers. */
export function toolResultLine(text: string, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", content: text, is_error: isError }] },
  });
}

/** The closing success line. */
export function successResult(text: string, turns = 3): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: text,
    num_turns: turns,
    permission_denials: [],
  });
}

/** Builds a fake that follows `script`. */
export function fakeClaude(script: FakeClaudeScript): FakeClaude {
  const fake: FakeClaude = {
    requests: [],
    kills: 0,
    spawner: (request) => {
      fake.requests.push(request);
      let end: (exit: AgentProcessExit) => void = () => undefined;
      const exited = new Promise<AgentProcessExit>((resolve) => {
        end = resolve;
      });
      if (script.cannotStart !== undefined) {
        end({ exitCode: -1, errorText: script.cannotStart });
      } else {
        setImmediate(() => {
          for (const line of script.lines) request.onLine(line);
          if (script.hang !== true) end(script.exit ?? { exitCode: 0, errorText: "" });
        });
      }
      return {
        kill() {
          fake.kills += 1;
          end({ exitCode: 143, errorText: "" });
        },
        exited,
      };
    },
  };
  return fake;
}
