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
 * ASSUMPTION: `-p <prompt>` prints the reply as plain text and exits.
 * Example: `buildClaudeArguments("Say hi")` gives `["-p", "Say hi"]`.
 */
export function buildClaudeArguments(prompt: string): string[] {
  return ["-p", prompt];
}

/**
 * Arguments for Codex in non-interactive mode.
 * ASSUMPTIONS: `exec <prompt>` runs one prompt and exits; `--sandbox read-only` stops it from
 * writing files; `--skip-git-repo-check` lets it run outside a git folder.
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
