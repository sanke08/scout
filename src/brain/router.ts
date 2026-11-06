/**
 * The brain Scout's modules actually use: cache first, then the daily budget, then the main engine,
 * then the fallback engine, and a plain failure value when nothing can answer (degraded mode).
 *
 * Why it exists: scenario K. When Claude Code reports its limit, Codex takes over; when both are
 * out, Scout keeps doing the work that needs no model and the scoring queue waits.
 */
import { createHash } from "node:crypto";
import type { Brain, BrainRequest, BrainResult } from "../shared/index.js";
import { nextUtcMidnight, type CallBudget } from "./budget.js";
import type { BrainCache } from "./cache.js";
import type { BrainFailure } from "./reply-pipeline.js";
import { describeSchema } from "./schema-description.js";

/** Options for `createBrainRouter`. */
export interface BrainRouterOptions {
  /** The engine tried first. */
  primary: Brain;
  /** The engine tried when the primary is limited or unavailable. Optional. */
  fallback?: Brain;
  /** The daily cap on real engine calls. */
  budget: CallBudget;
  /** Where replies are remembered. */
  cache: BrainCache;
  /**
   * The profile version (`profile.version`) at the time of creation. It is part of the cache key, so
   * a changed profile never reuses old replies. Long-running programs create a new router when the
   * profile version changes.
   */
  profileVersion: number;
  /** The clock for the "next reset at midnight UTC" time; give the budget the same clock. Default: the real time. */
  now?: () => Date;
}

/** The message returned when the daily allowance is spent. */
const BUDGET_USED_MESSAGE = "daily model call budget used";

/**
 * The key a request is cached under: a sha256 of its task, instructions, untrusted text, schema
 * description and the profile version.
 * Example: two requests that differ only in `untrustedText` get different keys.
 */
export function buildCacheKey<T>(request: BrainRequest<T>, profileVersion: number): string {
  const parts = [
    request.task,
    request.instructions,
    request.untrustedText ?? "",
    describeSchema(request.schema).description,
    String(profileVersion),
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Chooses the failure to report when every engine failed: a limit (with the earliest reset time)
 * if any engine was limited, otherwise the last "unavailable".
 */
function summariseFailures(failures: BrainFailure[]): BrainFailure {
  const limited = failures.filter((failure) => failure.reason === "limit-reached");
  if (limited.length === 0) return failures[failures.length - 1]!;
  const resetTimes = limited.flatMap((failure) => (failure.resetAt ? [failure.resetAt] : []));
  const earliest = resetTimes.sort()[0];
  const failure: BrainFailure = {
    ok: false,
    reason: "limit-reached",
    message: limited.map((item) => item.message).join(" "),
  };
  if (earliest) failure.resetAt = earliest;
  return failure;
}

/**
 * Creates the router. Rules:
 * - A cache hit returns at once and costs no budget.
 * - Each real engine call spends one budget unit per request. A call that ends in "limit-reached"
 *   or "unavailable" is given back, because no model work was done. A retry inside one engine for
 *   invalid output is not counted separately.
 * - A limit or an unavailable engine moves on to the fallback. If every engine fails, the failure is
 *   returned immediately (no waiting) so the caller can degrade.
 * - Only valid replies are cached. Two identical requests at the same moment share one engine call.
 *
 * Example: with the primary limited and a working fallback, `run(request)` gives `ok: true` with
 * `engine` set to the fallback's name.
 */
export function createBrainRouter(options: BrainRouterOptions): Brain {
  const now = options.now ?? (() => new Date());
  const engines = options.fallback ? [options.primary, options.fallback] : [options.primary];
  const inFlight = new Map<string, Promise<BrainResult<unknown>>>();

  const readCache = async <T>(
    key: string,
    request: BrainRequest<T>,
  ): Promise<BrainResult<T> | undefined> => {
    const stored = await options.cache.get(key);
    if (!stored) return undefined;
    const checked = request.schema.safeParse(stored.value);
    if (!checked.success) return undefined;
    return { ok: true, value: checked.data, engine: stored.engine, cached: true };
  };

  const runUncached = async <T>(key: string, request: BrainRequest<T>): Promise<BrainResult<T>> => {
    const hit = await readCache(key, request);
    if (hit) return hit;

    const failures: BrainFailure[] = [];
    for (const engine of engines) {
      const take = await options.budget.take();
      if (!take.allowed) {
        return {
          ok: false,
          reason: "limit-reached",
          message: BUDGET_USED_MESSAGE,
          resetAt: nextUtcMidnight(now()).toISOString(),
        };
      }
      const result = await engine.run(request);
      if (result.ok) {
        await rememberReply(key, result);
        return result;
      }
      if (result.reason === "invalid-output") return result;
      await take.giveBack();
      failures.push(result);
    }
    return summariseFailures(failures);
  };

  const rememberReply = async <T>(
    key: string,
    result: Extract<BrainResult<T>, { ok: true }>,
  ): Promise<void> => {
    try {
      await options.cache.set(key, { engine: result.engine, value: result.value });
    } catch {
      // A cache that cannot write must not lose a reply that was already paid for.
    }
  };

  return {
    name: engines.map((engine) => engine.name).join("+"),
    run<T>(request: BrainRequest<T>): Promise<BrainResult<T>> {
      const key = buildCacheKey(request, options.profileVersion);
      const running = inFlight.get(key);
      if (running) return running as Promise<BrainResult<T>>;
      const work = runUncached(key, request).finally(() => inFlight.delete(key));
      inFlight.set(key, work);
      return work;
    },
  };
}
