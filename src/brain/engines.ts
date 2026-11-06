/**
 * How Scout talks to each model program: the command name and the arguments.
 *
 * The flags below were checked against the installed tools (`claude --help`, `codex exec --help`)
 * on 2026-11-07, and the Claude call was tried once for real. They live only in this file, so a
 * change in either tool is a one-file fix. The prompt is NOT an argument: it is sent on standard
 * input, so a large batch of postings can never hit the operating system's argument-length limit.
 */

/** The two supported model programs. */
export type EngineName = "claude" | "codex";

/**
 * Everything needed to run one engine.
 * Example: `{ command: "claude", buildArguments: () => ["-p"] }`.
 */
export interface EngineConfiguration {
  /** The program to start. Example: "claude". Use a full path here if it is not on PATH. */
  command: string;
  /** The program's arguments. The prompt itself is written to the program's standard input. */
  buildArguments(): string[];
}

/**
 * Arguments for Claude Code in non-interactive mode.
 * Checked against `claude --help` on 2026-11-07: `-p` prints the reply and exits, `--tools ""`
 * turns off every built-in tool (so the model can only answer, never read or edit files), and
 * `--no-session-persistence` keeps these calls out of the user's saved sessions.
 * With no prompt argument, `-p` reads the prompt from standard input.
 * Example: `buildClaudeArguments()` gives `["-p", "--tools", "", "--no-session-persistence"]`.
 */
export function buildClaudeArguments(): string[] {
  return ["-p", "--tools", "", "--no-session-persistence"];
}

/**
 * Arguments for Codex in non-interactive mode.
 * Checked against `codex exec --help` on 2026-11-07: `exec` runs one prompt and exits, reading the
 * instructions from standard input when no prompt argument is given; `--sandbox read-only` stops
 * it from writing files; `--skip-git-repo-check` lets it run outside a git folder.
 * Example: `buildCodexArguments()` gives `["exec", "--sandbox", "read-only", "--skip-git-repo-check"]`.
 */
export function buildCodexArguments(): string[] {
  return ["exec", "--sandbox", "read-only", "--skip-git-repo-check"];
}

/**
 * The single configuration object for both engines (see the top of the file for how it was checked).
 * Example: `ENGINE_CONFIGURATIONS.codex.command` is "codex".
 */
export const ENGINE_CONFIGURATIONS: Record<EngineName, EngineConfiguration> = {
  claude: { command: "claude", buildArguments: buildClaudeArguments },
  codex: { command: "codex", buildArguments: buildCodexArguments },
};
