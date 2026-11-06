# brain

The model bridge: Claude Code and Codex behind one `Brain` interface, schema-checked replies, budget, cache, fallback, degraded mode, claim check, and a `FakeBrain` for tests.

**Owner:** the `brain` agent, branch `feat/brain`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/brain/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `brain` section of [docs/PLAN.md](../../docs/PLAN.md).

## Glossary

Define each term of this module once here; code and comments use the short form.
