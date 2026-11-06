/**
 * Running an outside program (the `claude` or `codex` command) and collecting what it prints.
 *
 * Why it exists: the rest of the brain module only sees a `ProcessRunner` function, so tests can
 * replace it with a fake that never starts a real program, and the real one carries the safety
 * limits (a timeout and an output size cap) in one place.
 */
import { spawn } from "node:child_process";

/** What a finished program left behind. Example: `{ stdout: "{\"ok\":true}", stderr: "", exitCode: 0 }`. */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  /** 0 means success. Any other number means the program reported a problem. */
  exitCode: number;
}

/**
 * Starts `command` with `args`, writes `input` to its standard input, and resolves when it ends.
 *
 * Example: `await runner("claude", ["-p", "Say hi"], "")` gives `{ stdout: "Hi", stderr: "", exitCode: 0 }`.
 * It rejects (throws) when the program cannot start (missing binary), takes too long, or prints
 * too much. The brain turns every rejection into an "unavailable" result.
 */
export type ProcessRunner = (
  command: string,
  args: readonly string[],
  input: string,
) => Promise<ProcessResult>;

/** The two safety limits of the real runner. */
export interface ProcessLimits {
  /** How long the program may run before it is killed. Example: 300000 is five minutes. */
  timeoutMilliseconds: number;
  /** How many bytes it may print (stdout and stderr together) before it is killed. */
  maxOutputBytes: number;
}

/** Limits used when the caller gives none: five minutes and two megabytes. */
export const DEFAULT_PROCESS_LIMITS: ProcessLimits = {
  timeoutMilliseconds: 5 * 60 * 1000,
  maxOutputBytes: 2 * 1024 * 1024,
};

/**
 * Builds the real runner on top of `node:child_process`.
 *
 * Example: `createProcessRunner({ timeoutMilliseconds: 1000 })` kills any program that runs longer
 * than one second and rejects with an `Error` saying so.
 * Failure means: a rejected promise whose message says what limit was hit or why the start failed.
 */
export function createProcessRunner(limits: Partial<ProcessLimits> = {}): ProcessRunner {
  const { timeoutMilliseconds, maxOutputBytes } = { ...DEFAULT_PROCESS_LIMITS, ...limits };

  return (command, args, input) =>
    new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let finished = false;

      const finish = (settle: () => void): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        settle();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error(`${command} ran longer than ${timeoutMilliseconds} ms.`)));
      }, timeoutMilliseconds);

      const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxOutputBytes) {
          child.kill("SIGKILL");
          finish(() => reject(new Error(`${command} printed more than ${maxOutputBytes} bytes.`)));
          return;
        }
        chunks.push(chunk);
      };

      child.stdout.on("data", collect(stdoutChunks));
      child.stderr.on("data", collect(stderrChunks));
      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (exitCode) =>
        finish(() =>
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode: exitCode ?? -1,
          }),
        ),
      );
      // A program that exits before reading its input closes the pipe; that is not our failure.
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
}
