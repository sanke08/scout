/**
 * The daily cap on real model calls (idea document 5.12).
 *
 * Why it exists: the model runs on the user's subscription, so Scout spends a fixed number of calls
 * per UTC day and then waits for the next day instead of burning the whole allowance.
 */
import { join } from "node:path";
import { z } from "zod";
import { readJsonIfPresent, writeJsonAtomically } from "./atomic-json.js";
import { ScoutError } from "../shared/index.js";

/** The outcome of asking to spend one call. */
export type BudgetTake =
  | {
      allowed: true;
      /** Returns the call to the budget when the engine turned out not to be called for real. */
      giveBack(): Promise<void>;
    }
  | { allowed: false };

/** Spends calls from a daily allowance. */
export interface CallBudget {
  /** Tries to spend one call. Example: with a limit of 2, the third `take()` of a day is refused. */
  take(): Promise<BudgetTake>;
}

/** Options shared by both budgets. */
export interface BudgetOptions {
  /** How many calls are allowed per UTC day. Must be a whole number of at least 1. */
  limitPerDay: number;
  /** The clock. Default: the real time. Tests pass a fixed, movable one. */
  now?: () => Date;
}

/** What is counted: which UTC day, and how many calls were spent that day. */
interface BudgetState {
  day: string;
  used: number;
}

/** The saved form of the count, checked when read from a file. */
const budgetStateSchema = z.object({ day: z.string(), used: z.number().int().min(0) });

/** Where the count is kept. */
interface BudgetStorage {
  read(): Promise<BudgetState | undefined>;
  write(state: BudgetState): Promise<void>;
}

/** The UTC calendar day of a moment. Example: 2026-11-07T23:59:00Z gives "2026-11-07". */
function utcDay(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** The next midnight UTC after `moment`, when a daily count starts again. Example: 2026-11-07T10:00Z gives 2026-11-08T00:00:00.000Z. */
export function nextUtcMidnight(moment: Date): Date {
  return new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate() + 1));
}

/**
 * Builds a budget on top of some storage. Calls to `take` and `giveBack` run one after another so
 * two requests at the same moment cannot both spend the last call.
 */
function createBudget(options: BudgetOptions, storage: BudgetStorage): CallBudget {
  if (!Number.isInteger(options.limitPerDay) || options.limitPerDay < 1) {
    throw new ScoutError(
      "invalid-input",
      "The daily model call budget must be a whole number of at least 1.",
    );
  }
  const now = options.now ?? (() => new Date());
  let queueTail: Promise<unknown> = Promise.resolve();

  const exclusively = <R>(work: () => Promise<R>): Promise<R> => {
    const result = queueTail.then(work);
    queueTail = result.catch(() => undefined);
    return result;
  };

  const readToday = async (day: string): Promise<BudgetState> => {
    const saved = await storage.read();
    return saved && saved.day === day ? saved : { day, used: 0 };
  };

  return {
    take: () =>
      exclusively(async (): Promise<BudgetTake> => {
        const moment = now();
        const day = utcDay(moment);
        const state = await readToday(day);
        if (state.used >= options.limitPerDay) {
          return { allowed: false };
        }
        await storage.write({ day, used: state.used + 1 });
        return {
          allowed: true,
          giveBack: () =>
            exclusively(async () => {
              const current = await readToday(day);
              if (current.used > 0) await storage.write({ day, used: current.used - 1 });
            }),
        };
      }),
  };
}

/**
 * A budget kept in memory: the count restarts when the process does.
 * Example: `createDailyBudget({ limitPerDay: 40 })`.
 */
export function createDailyBudget(options: BudgetOptions): CallBudget {
  let state: BudgetState | undefined;
  return createBudget(options, {
    async read() {
      return state;
    },
    async write(next) {
      state = next;
    },
  });
}

/**
 * A budget kept in `folder/model-budget.json`, so separate Scout runs on the same day share one
 * count. Example: `createFileDailyBudget("/data", { limitPerDay: 40 })`.
 * Two programs writing at the same instant could miscount by one; one Scout process at a time is
 * the expected use.
 */
export function createFileDailyBudget(folder: string, options: BudgetOptions): CallBudget {
  const file = join(folder, "model-budget.json");
  return createBudget(options, {
    async read() {
      const parsed = budgetStateSchema.safeParse(await readJsonIfPresent(file));
      return parsed.success ? parsed.data : undefined;
    },
    async write(next) {
      await writeJsonAtomically(file, next);
    },
  });
}
