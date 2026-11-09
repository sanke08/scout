/**
 * Joins the application's real parts into what the web server needs.
 *
 * Why it exists: `startWebServer` takes its dependencies as arguments; this is the one place that
 * says which real store, builder and provider go where, so `serve` and the tests agree.
 *
 * Example: `await startWebServer(createWebDependencies(application), { port: 0 })`.
 */
import type { WebDependencies } from "../web/index.js";
import type { Application } from "./application.js";
import { createDigestProvider, createPendingProposals } from "./digest-provider.js";

/** Builds the web dependencies from an open application. */
export function createWebDependencies(application: Application): WebDependencies {
  return {
    profileStore: application.profileStore,
    settingsStore: application.settingsStore,
    jobStore: application.jobStore,
    resumeBuilder: application.resumeBuilder,
    digestProvider: createDigestProvider(application),
    pendingProposals: createPendingProposals(application),
    ledger: application.ledger,
    now: application.now,
  };
}
