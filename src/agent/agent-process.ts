/**
 * Starting the `claude` command for an autopilot run, and the seam tests replace.
 *
 * Why it exists: the runner needs lines of output as they arrive, a way to kill the command, and
 * its exit. Tests pass a fake `AgentSpawner` that prints canned stream-json and never starts a
 * real program.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** What the runner asks the spawner to start. */
export interface AgentProcessRequest {
  command: string;
  args: readonly string[];
  /** Written to the command's standard input, which is then closed. */
  input: string;
  /** Called once per line of standard output, as it arrives. */
  onLine(line: string): void;
}

/** How the command ended. `exitCode` is -1 when it never started. */
export interface AgentProcessExit {
  exitCode: number;
  /** The start of what it printed on the error stream, or the reason it could not start. */
  errorText: string;
}

/** A running command. */
export interface AgentProcess {
  /** Stops the command now. Safe to call twice. */
  kill(): void;
  /** Resolves when the command has ended and every output line was delivered. Never rejects. */
  exited: Promise<AgentProcessExit>;
}

/** Starts a command. Never throws: a failure to start shows up as an exit with code -1. */
export type AgentSpawner = (request: AgentProcessRequest) => AgentProcess;

/** How many characters of the error stream are kept. */
const MAXIMUM_ERROR_CHARACTERS = 2000;

/** How long the command may take to obey a polite stop before it is killed hard. */
const KILL_ESCALATION_MILLISECONDS = 3000;

/** The real spawner, over `node:child_process`. */
export const spawnAgentProcess: AgentSpawner = (request) => {
  const child = spawn(request.command, [...request.args], { stdio: ["pipe", "pipe", "pipe"] });
  let errorText = "";
  let startFailure: string | undefined;

  const lines = createInterface({ input: child.stdout });
  lines.on("line", request.onLine);
  child.stderr.on("data", (chunk: Buffer) => {
    if (errorText.length < MAXIMUM_ERROR_CHARACTERS) errorText += chunk.toString("utf8");
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(request.input);

  const exited = new Promise<AgentProcessExit>((resolve) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      startFailure =
        error.code === "ENOENT"
          ? `The "${request.command}" command was not found. Install Claude Code and sign in with it.`
          : error.message;
      resolve({ exitCode: -1, errorText: startFailure });
    });
    child.on("close", (exitCode) => {
      lines.close();
      resolve({
        exitCode: exitCode ?? -1,
        errorText: startFailure ?? errorText.slice(0, MAXIMUM_ERROR_CHARACTERS),
      });
    });
  });

  return {
    kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_ESCALATION_MILLISECONDS).unref();
    },
    exited,
  };
};
