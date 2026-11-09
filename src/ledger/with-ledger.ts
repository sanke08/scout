/**
 * Wraps a job store so every status change is also written to the ledger.
 *
 * Why it exists: Scout moves jobs from many places (apply, inbox, the Digest, the command line).
 * Hooking the one place they all pass through means the history and `APPLICATIONS.md` can never be
 * forgotten by a new feature.
 *
 * Failure: a ledger problem never undoes or blocks the status change; it is reported to `onError`.
 */
import type { JobStore } from "../shared/index.js";
import type { Ledger } from "./ledger.js";

/**
 * Returns a store that behaves like `inner` and tells the ledger after each transition.
 * `ledger` is a function because the ledger itself is built on the wrapped store.
 */
export function withLedger(
  inner: JobStore,
  ledger: () => Ledger | undefined,
  onError: (message: string) => void,
): JobStore {
  return {
    upsertPosting: (posting) => inner.upsertPosting(posting),
    get: (id) => inner.get(id),
    list: (filter) => inner.list(filter),
    transition(id, to, reason) {
      const before = inner.get(id);
      const after = inner.transition(id, to, reason);
      if (before !== undefined) {
        try {
          ledger()?.noteTransition(id, before.status, after.status, reason);
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }
      return after;
    },
  };
}
