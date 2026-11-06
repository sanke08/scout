# store

SQLite storage for jobs and the action log, the job state machine, and the settings file. Implements `JobStore`, `ActionLog` and `SettingsStore` from `src/shared/ports.ts`.

**Owner:** the `store` agent, branch `feat/store`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/store/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `store` section of [docs/PLAN.md](../../docs/PLAN.md).

## Glossary

Define each term of this module once here; code and comments use the short form.
