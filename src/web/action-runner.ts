/**
 * The background runner behind the Control tab's buttons: it runs one named action at a time, keeps
 * what is running and the result of each finished action in memory, and turns every failure into a
 * failed result instead of an error that could stop the server.
 *
 * Why it exists: finding jobs and reading mail take a while, so the page starts them and checks
 * back. Only one may run at once, so two clicks never run discovery twice at the same moment. The
 * runner knows nothing about what an action does; the application passes the real functions in.
 *
 * Example: `const runner = createActionRunner([{ name: "discover", run: async () => ({ summary: "Done." }) }])`;
 * `runner.start("discover")` returns at once with `running` set; `runner.state().last` has the result later.
 */
import { ScoutError, createLogger } from "../shared/index.js";
import { HttpError } from "./http-helpers.js";

const log = createLogger("web");

/** What a finished action reports. */
export interface ActionOutcome {
  /** One plain sentence for the owner, e.g. "Read 3 boards, 2 jobs shortlisted." Never a secret. */
  summary: string;
  /** Small named numbers or words a view may show, e.g. `{ shortlisted: 2 }`. */
  facts?: Record<string, string | number | boolean>;
}

/** One thing the page may start. */
export interface ActionDefinition {
  /** The name in the address, e.g. `discover`. */
  name: string;
  /**
   * Runs before the action starts and throws a `ScoutError` when it must not run now (kill switch on,
   * mail settings missing). A refusal here starts nothing and records no result.
   */
  check?: () => void;
  /** The work itself. A thrown error becomes a failed result. */
  run: () => Promise<ActionOutcome>;
}

/** How one finished action ended. */
export interface ActionResult {
  name: string;
  ok: boolean;
  /** What happened, in one plain sentence; for a failure, why. */
  summary: string;
  startedAt: string;
  finishedAt: string;
  facts?: Record<string, string | number | boolean>;
}

/** What the runner is doing and what it last did. */
export interface ActionState {
  running: { name: string; startedAt: string } | null;
  /** The most recent finished action of any name, or `null` when none finished yet. */
  last: ActionResult | null;
  /** The most recent finished result of each action by name. */
  lastByName: Record<string, ActionResult>;
}

/** Starts actions one at a time. */
export interface ActionRunner {
  /**
   * Starts the named action in the background and returns the state at once.
   * Failure: `HttpError` 404 for an unknown name, 409 while another action runs; a `ScoutError`
   * from the action's `check`.
   */
  start(name: string): ActionState;
  /** The current state. */
  state(): ActionState;
}

/** The sentence shown for a failure that carries no message meant for the owner. */
const UNEXPECTED_FAILURE =
  "Scout hit an unexpected problem while running this. Check the terminal for details.";

/** Creates a runner for these actions. `now` is the clock (tests pass a fixed one). */
export function createActionRunner(
  actions: readonly ActionDefinition[],
  now: () => Date = () => new Date(),
): ActionRunner {
  let running: ActionState["running"] = null;
  let last: ActionResult | null = null;
  const lastByName: Record<string, ActionResult> = {};

  function state(): ActionState {
    return { running: running && { ...running }, last, lastByName: { ...lastByName } };
  }

  async function execute(definition: ActionDefinition, startedAt: string): Promise<void> {
    let result: ActionResult;
    try {
      const outcome = await definition.run();
      result = {
        name: definition.name,
        ok: true,
        summary: outcome.summary,
        startedAt,
        finishedAt: now().toISOString(),
        ...(outcome.facts === undefined ? {} : { facts: outcome.facts }),
      };
    } catch (error) {
      let summary = UNEXPECTED_FAILURE;
      if (error instanceof ScoutError) summary = error.message;
      else {
        // Only the kind of error is logged: a mail or network error can carry an address or user name.
        log.error("an action failed", {
          action: definition.name,
          kind: error instanceof Error ? error.name : typeof error,
        });
      }
      result = {
        name: definition.name,
        ok: false,
        summary,
        startedAt,
        finishedAt: now().toISOString(),
      };
    }
    last = result;
    lastByName[definition.name] = result;
    running = null;
  }

  return {
    state,
    start(name) {
      const definition = actions.find((action) => action.name === name);
      if (definition === undefined) {
        throw new HttpError(404, "There is no action with that name.");
      }
      if (running !== null) {
        throw new HttpError(
          409,
          "Another action is still running. Wait for it to finish, then try again.",
        );
      }
      definition.check?.();
      const startedAt = now().toISOString();
      running = { name, startedAt };
      void execute(definition, startedAt);
      return state();
    },
  };
}
