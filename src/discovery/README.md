# discovery

Job board fetchers, normaliser, dedupe, freshness and ghost flags. Implements `Discovery`. Tests use saved board responses in `fixtures/boards/`.

**Owner:** the `discovery` agent, branch `feat/discovery`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/discovery/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `discovery` section of [docs/PLAN.md](../../docs/PLAN.md).

## Glossary

Define each term of this module once here; code and comments use the short form.
