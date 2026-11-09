/**
 * How Scout talks to the model program: the command name and the arguments.
 *
 * Only one model is used (D-013): Sonnet 5.5, run by the `claude` command with the owner's own
 * login. The flags were checked against the installed tool (`claude --help`) and tried once for
 * real. They live only in this file, so a change in the tool is a one-file fix. The prompt is NOT
 * an argument: it is sent on standard input, so a large batch of postings can never hit the
 * operating system's argument-length limit.
 */

/** The only supported model program. */
export type EngineName = "claude";

/** The model Scout always asks for. One source of truth for the name. */
export const MODEL_NAME = "claude-sonnet-5-5";

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
 * Arguments for Claude Code in non-interactive mode, for one-shot questions (notes, interview
 * plans, mail classification).
 * `-p` prints the reply and exits, `--model` pins Sonnet 5.5, `--tools ""` turns off every
 * built-in tool (so the model can only answer, never read or edit files), and
 * `--no-session-persistence` keeps these calls out of the user's saved sessions.
 * With no prompt argument, `-p` reads the prompt from standard input.
 * Example: `buildClaudeArguments()` gives `["-p", "--model", "claude-sonnet-5-5", "--tools", "", "--no-session-persistence"]`.
 */
export function buildClaudeArguments(): string[] {
  return ["-p", "--model", MODEL_NAME, "--tools", "", "--no-session-persistence"];
}

/**
 * The configuration of the one engine.
 * Example: `ENGINE_CONFIGURATIONS.claude.command` is "claude".
 */
export const ENGINE_CONFIGURATIONS: Record<EngineName, EngineConfiguration> = {
  claude: { command: "claude", buildArguments: buildClaudeArguments },
};
