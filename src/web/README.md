# web

The local web server and the Digest, Profile and Settings page, bound to 127.0.0.1. The approved look and behaviour is in `reference/scout-page.html` (fictional data).

**Owner:** the `web` agent, branch `feat/web`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/web/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `web` section of [docs/PLAN.md](../../docs/PLAN.md).

## Glossary

Define each term of this module once here; code and comments use the short form.
