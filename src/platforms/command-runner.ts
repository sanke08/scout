/**
 * The one way the credential vault starts the operating system's keychain program.
 *
 * Why it exists: the vault must never need a real keychain in a test, and it must start the
 * program in exactly two ways. `interactive` gives the program the user's own terminal, so the
 * program itself asks for the password and Scout never sees it. `captured` collects what the
 * program prints into memory (used only to read a password back for one sign-in).
 *
 * Example: `await runner.captured("security", ["find-generic-password", "-s", "scout-platform-x", "-w"])`
 * gives `{ toolMissing: false, exitCode: 0, output: "the-password\n" }`.
 */
import { spawn } from "node:child_process";

/** What happened when a program was started. */
export interface CommandResult {
  /** True when the program does not exist on this computer. */
  toolMissing: boolean;
  /** The exit code, or `-1` when the program could not run or was stopped by a signal. */
  exitCode: number;
  /** Standard output, for `captured` only. Always an empty string for `interactive`. */
  output: string;
}

/** Starts programs on behalf of the vault. Tests pass a fake. */
export interface CommandRunner {
  /** Runs the program attached to the user's terminal (input, output and errors). Nothing is captured. */
  interactive(command: string, args: readonly string[]): Promise<CommandResult>;
  /** Runs the program with no input and collects what it prints. Its error output is thrown away. */
  captured(command: string, args: readonly string[]): Promise<CommandResult>;
}

/** Starts one program and resolves with its result; a missing program is a result, not a failure. */
function start(
  command: string,
  args: readonly string[],
  mode: "interactive" | "captured",
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: mode === "interactive" ? "inherit" : ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      resolve({ toolMissing: error.code === "ENOENT", exitCode: -1, output: "" });
    });
    child.once("close", (code) => {
      resolve({ toolMissing: false, exitCode: code ?? -1, output });
    });
  });
}

/** The real runner, built on the Node standard library. Untested against a real keychain. */
export function createProcessCommandRunner(): CommandRunner {
  return {
    interactive: (command, args) => start(command, args, "interactive"),
    captured: (command, args) => start(command, args, "captured"),
  };
}
