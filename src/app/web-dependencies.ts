/**
 * Joins the application's real parts into what the web server needs.
 *
 * Why it exists: `startWebServer` takes its dependencies as arguments; this is the one place that
 * says which real store, builder, provider and background action go where, so `serve` and the
 * tests agree.
 *
 * Example: `await startWebServer(createWebDependencies(application), { port: 0 })`.
 */
import { join } from "node:path";
import { createSessionStore, resolveVault, type PlatformOverrides } from "../platforms/index.js";
import { createActionRunner, type ActionDefinition, type WebDependencies } from "../web/index.js";
import type { Application } from "./application.js";
import { PLATFORM_SESSIONS_FILE } from "./commands/platform-services.js";
import { createDigestProvider, createPendingProposals } from "./digest-provider.js";
import { runDiscoveryPass, type DiscoveryPassSummary } from "./discovery-pass.js";
import { assertInboxCanRun, runInboxPass, summariseInboxPass } from "./inbox-pass.js";

/** The model Scout works with, shown read-only on the Control tab. */
export const MODEL_NAME = "Sonnet 5.5";

/** One plain sentence about a discovery pass, e.g. "Read 3 boards (1 failed). 12 postings, 2 shortlisted." */
export function summariseDiscoveryPass(summary: DiscoveryPassSummary): string {
  const mode =
    summary.mode === "degraded"
      ? " The model could not be used, so keyword score alone decided the shortlist."
      : "";
  return (
    `Read ${summary.boardsRead} boards (${summary.boardsFailed.length} failed). ` +
    `${summary.postingsAfterDedupe} postings, ${summary.droppedByRules} dropped by rules, ` +
    `${summary.shortlisted} shortlisted, ${summary.keptForReview} kept for review.${mode}`
  );
}

/** The two actions the Control tab can start: the same work as `scout discover` and `scout inbox`. */
function createActions(application: Application): ActionDefinition[] {
  return [
    {
      name: "discover",
      run: async () => {
        const summary = await runDiscoveryPass(application);
        return {
          summary: summariseDiscoveryPass(summary),
          facts: { mode: summary.mode, shortlisted: summary.shortlisted },
        };
      },
    },
    {
      name: "inbox",
      check: () => assertInboxCanRun(application),
      run: async () => ({ summary: summariseInboxPass(await runInboxPass(application, {})) }),
    },
  ];
}

/** Builds the web dependencies from an open application. `platforms` replaces the keychain in tests. */
export function createWebDependencies(
  application: Application,
  options: { platforms?: PlatformOverrides } = {},
): WebDependencies {
  return {
    profileStore: application.profileStore,
    settingsStore: application.settingsStore,
    jobStore: application.jobStore,
    resumeBuilder: application.resumeBuilder,
    digestProvider: createDigestProvider(application),
    pendingProposals: createPendingProposals(application),
    ledger: application.ledger,
    actions: createActionRunner(createActions(application), application.now),
    healthReport: () => application.healthReport(),
    modelName: MODEL_NAME,
    platforms: {
      sessions: createSessionStore(join(application.directory, PLATFORM_SESSIONS_FILE)),
      vault: resolveVault(options.platforms),
      recordChange: (detail) =>
        application.actionLog.append({
          actor: "platforms",
          action: "platform-settings-changed",
          detail,
        }),
    },
    now: application.now,
  };
}
