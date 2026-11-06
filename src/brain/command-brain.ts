/**
 * The real `Brain`: runs `claude` or `codex` as a command and checks what it prints.
 *
 * Why it exists: Scout uses the user's existing subscription through the command-line tools (no API
 * key). Everything that can go wrong (missing program, crash, limit, bad output) comes back as a
 * failure value so callers can degrade instead of crashing.
 */
import type { Brain, BrainRequest, BrainResult } from "../shared/index.js";
import { ENGINE_CONFIGURATIONS, type EngineConfiguration, type EngineName } from "./engines.js";
import { extractFirstJson } from "./json-extract.js";
import { detectLimit } from "./limit-detection.js";
import { createProcessRunner, type ProcessResult, type ProcessRunner } from "./process-runner.js";
import { askUntilValid, type EngineReply } from "./reply-pipeline.js";

/** Options for `createCommandBrain`. Only `engine` is required. */
export interface CommandBrainOptions {
  /** Which program to run: "claude" or "codex". */
  engine: EngineName;
  /** Starts programs. Default: the real runner with a timeout and an output cap. Tests pass a fake. */
  runner?: ProcessRunner;
  /** The clock. Default: the real time. Tests pass a fixed one. */
  now?: () => Date;
  /** Replaces the built-in command and flags, e.g. to give a full path to the program. */
  configuration?: EngineConfiguration;
  /** How long to leave the engine alone after a limit message with no reset time. Default 60. */
  unknownResetCooldownMinutes?: number;
}

/** How many characters of an error stream are quoted in a failure message. */
const MAXIMUM_QUOTED_CHARACTERS = 200;

/** Turns a finished program run into an `EngineReply` (a limit, a failure, or text to check). */
function interpretProcessResult(command: string, result: ProcessResult, now: Date): EngineReply {
  if (result.exitCode !== 0) {
    const limit = detectLimit(result.stdout, result.stderr, now);
    if (limit.limited)
      return limit.resetAt ? { kind: "limit", resetAt: limit.resetAt } : { kind: "limit" };
    const quoted = result.stderr.trim().slice(0, MAXIMUM_QUOTED_CHARACTERS);
    return {
      kind: "unavailable",
      message: `${command} stopped with exit code ${result.exitCode}.${quoted ? ` It said: ${quoted}` : ""}`,
    };
  }
  // A good JSON reply wins even if it mentions a "rate limit" in its own text.
  if (!extractFirstJson(result.stdout).found) {
    const limit = detectLimit(result.stdout, result.stderr, now);
    if (limit.limited)
      return limit.resetAt ? { kind: "limit", resetAt: limit.resetAt } : { kind: "limit" };
  }
  return { kind: "text", text: result.stdout };
}

/**
 * Creates a brain that runs one engine as a command.
 *
 * Example: `createCommandBrain({ engine: "claude" }).run({ task: "score", instructions: "...", schema })`
 * resolves to `{ ok: true, value, engine: "claude", cached: false }` or a failure value.
 * After a limit message the brain refuses to call the engine again until the reset time (or until
 * the cooldown passes when no reset time was given) and answers "limit-reached" straight away.
 * The limit memory lasts for this brain object only (one process).
 */
export function createCommandBrain(options: CommandBrainOptions): Brain {
  const configuration = options.configuration ?? ENGINE_CONFIGURATIONS[options.engine];
  const runner = options.runner ?? createProcessRunner();
  const now = options.now ?? (() => new Date());
  const cooldownMinutes = options.unknownResetCooldownMinutes ?? 60;
  let limitedUntil: Date | undefined;
  let limitedUntilIsKnown = false;

  const callEngine = async (prompt: string): Promise<EngineReply> => {
    try {
      const result = await runner(configuration.command, configuration.buildArguments(prompt), "");
      return interpretProcessResult(configuration.command, result, now());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        kind: "unavailable",
        message: `Could not run ${configuration.command}: ${reason} Check that it is installed and signed in.`,
      };
    }
  };

  const rememberLimit = (resetAt: string | undefined): void => {
    limitedUntilIsKnown = resetAt !== undefined;
    limitedUntil = resetAt
      ? new Date(resetAt)
      : new Date(now().getTime() + cooldownMinutes * 60_000);
  };

  return {
    name: options.engine,
    async run<T>(request: BrainRequest<T>): Promise<BrainResult<T>> {
      if (limitedUntil && now().getTime() < limitedUntil.getTime()) {
        const resetAt = limitedUntilIsKnown ? limitedUntil.toISOString() : undefined;
        return {
          ok: false,
          reason: "limit-reached",
          message: `The ${options.engine} usage limit was reached; Scout will not call it again until ${limitedUntil.toISOString()}.`,
          ...(resetAt ? { resetAt } : {}),
        };
      }
      const result = await askUntilValid(options.engine, request, callEngine);
      if (!result.ok && result.reason === "limit-reached") rememberLimit(result.resetAt);
      return result;
    },
  };
}
