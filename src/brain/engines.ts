/**
 * How Scout talks to each model program: the command name and the arguments.
 *
 * ASSUMPTION WARNING: the exact flags of the Claude Code and Codex command-line tools are
 * assumptions written from memory of how those tools are documented. They live only in this file.
 * The owner must run each tool by hand and confirm the flags below before relying on them.
 */

/** The two supported model programs. */
export type EngineName = "claude" | "codex";

/**
 * Everything needed to run one engine.
 * Example: `{ command: "claude", buildArguments: (prompt) => ["-p", prompt] }`.
 */
export interface EngineConfiguration {
  /** The program to start. Example: "claude". Use a full path here if it is not on PATH. */
  command: string;
  /** Turns the finished prompt into the program's arguments. */
  buildArguments(prompt: string): string[];
}

/**
 * Arguments for Claude Code in non-interactive mode.
 * Checked against `claude --help` on 2026-11-07: `-p` prints the reply and exits, `--tools ""`
 * turns off every built-in tool (so the model can only answer, never read or edit files), and
 * `--no-session-persistence` keeps these calls out of the user's saved sessions.
 * Example: `buildClaudeArguments("Say hi")` gives
 * `["-p", "Say hi", "--tools", "", "--no-session-persistence"]`.
 */
export function buildClaudeArguments(prompt: string): string[] {
  return ["-p", prompt, "--tools", "", "--no-session-persistence"];
}

/**
 * Arguments for Codex in non-interactive mode.
 * Checked against `codex exec --help` on 2026-11-07: `exec <prompt>` runs one prompt and exits;
 * `--sandbox read-only` stops it from writing files; `--skip-git-repo-check` lets it run outside a
 * git folder.
 * Example: `buildCodexArguments("Say hi")` gives `["exec", "--sandbox", "read-only", "--skip-git-repo-check", "Say hi"]`.
 */
export function buildCodexArguments(prompt: string): string[] {
  return ["exec", "--sandbox", "read-only", "--skip-git-repo-check", prompt];
}

/**
 * The single configuration object for both engines (all flags are assumptions, see top of file).
 * Example: `ENGINE_CONFIGURATIONS.codex.command` is "codex".
 */
export const ENGINE_CONFIGURATIONS: Record<EngineName, EngineConfiguration> = {
  claude: { command: "claude", buildArguments: buildClaudeArguments },
  codex: { command: "codex", buildArguments: buildCodexArguments },
};
