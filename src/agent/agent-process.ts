/**
 * Starting the `claude` command for an autopilot run, and the seam tests replace.
 *
 * Why it exists: the runner needs lines of output as they arrive, a way to kill the command, and
 * its exit. Tests pass a fake `AgentSpawner` that prints canned stream-json and never starts a
 * real program.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** What the runner asks the spawner to start. */
export interface AgentProcessRequest {
  command: string;
  args: readonly string[];
  /** Written to the command's standard input, which is then closed. */
  input: string;
  /** Called once per line of standard output, as it arrives. */
  onLine(line: string): void;
  /** Tests shorten how long `exited` waits for the process group to end. Default: 65 seconds. */
  groupWaitMilliseconds?: number;
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
  /**
   * Resolves when the command has ended, every output line was delivered AND no program of its
   * process group is left (Scout's tool server may still be finishing a submit after `claude` has
   * gone). Waits at most `groupWaitMilliseconds`. The run lock is released only after this, so a
   * new run can never start while the old tool server still holds the database and the browser
   * profile. Never rejects.
   */
  exited: Promise<AgentProcessExit>;
}

/** Starts a command. Never throws: a failure to start shows up as an exit with code -1. */
export type AgentSpawner = (request: AgentProcessRequest) => AgentProcess;

/** How many characters of the error stream are kept. */
const MAXIMUM_ERROR_CHARACTERS = 2000;

/** How long `exited` waits for the process group: the tool server's drain (a minute) plus a margin. */
const GROUP_WAIT_MILLISECONDS = 65_000;

/** How often the process group is looked at while waiting for it to end. */
const GROUP_POLL_MILLISECONDS = 100;

/** True while any process of the group led by `leader` is still running. */
function groupIsRunning(leader: number): boolean {
  try {
    process.kill(-leader, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Waits until the group is gone or `limit` milliseconds have passed. */
async function waitForGroupToEnd(leader: number | undefined, limit: number): Promise<void> {
  if (leader === undefined) return;
  let waited = 0;
  while (groupIsRunning(leader) && waited < limit) {
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MILLISECONDS));
    waited += GROUP_POLL_MILLISECONDS;
  }
}

/** How long the command may take to obey a polite stop before it is killed hard. */
const KILL_ESCALATION_MILLISECONDS = 3000;

/**
 * Sends a signal to the whole process group of `child` (the command and every program it started,
 * including Scout's tool server), falling back to the command alone when the group is gone.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // The group no longer exists; try the command itself.
  }
  child.kill(signal);
}

/** The real spawner, over `node:child_process`. */
export const spawnAgentProcess: AgentSpawner = (request) => {
  // Its own process group, so a stop reaches the command AND the tool server it started.
  const child = spawn(request.command, [...request.args], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
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
      void waitForGroupToEnd(
        child.pid,
        request.groupWaitMilliseconds ?? GROUP_WAIT_MILLISECONDS,
      ).then(() =>
        resolve({
          exitCode: exitCode ?? -1,
          errorText: startFailure ?? errorText.slice(0, MAXIMUM_ERROR_CHARACTERS),
        }),
      );
    });
  });

  return {
    kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Polite stop for the whole group: the tool server finishes (and records) a submit that was
      // already past its marker, then ends. A hard kill goes to the command alone, never the group,
      // because killing the tool server mid-submit would strand the job; it ends by itself when its
      // input closes (waiting at most a minute for a running call).
      signalGroup(child, "SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, KILL_ESCALATION_MILLISECONDS).unref();
    },
    exited,
  };
};
