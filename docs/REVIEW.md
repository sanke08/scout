# Review checklist

For the module or step under review: run `npm run check`, then the module's **Verify** lines in [PLAN.md](PLAN.md), keep the actual output, and answer each line with pass or a finding (file and line). Reading the code is not a review.

1. The change does one feature set; non-goals respected; only the owned folder changed.
2. Every decision the code depends on is in [DECISIONS.md](DECISIONS.md).
3. Unit tests cover the logic; an integration test with fixtures needs nothing external.
4. Error paths are tested; after each failure nothing is left behind (files, handles, partial rows).
5. Untrusted input has size limits and safety checks; no secrets or real personal data in code, logs, fixtures or messages.
6. The feature is reachable through the module's `index.ts`, used by a test.
7. No dummy, test-only, placeholder or to-be-replaced code; no TODOs.
8. README of the folder and [PROGRESS.md](PROGRESS.md) agree with the code.
9. `npm run check` is clean and CI is green.
10. The module's Verify lines hold.
11. Names, comments and READMEs follow the code style below.
12. Nothing in the signs list below applies.

## Code style

- Full-word, short names, by purpose; no abbreviations; do not repeat what the folder or file already says.
- Every file, type, function, constant and module-level variable has a doc comment: what, why, how to use, what failure means, with an example of input and output. Plain words.
- Each term is defined once, in the folder README glossary; files use the short form.
- Plain code, one idea per function, explicit error handling, no clever tricks.
- Error messages are full sentences a user can act on.
- One source of truth for every value and type; tests may use plain literals.

## Signs the build is wrong (stop and fix)

- A flag, field, file or folder nothing uses yet.
- A test that only runs with the internet, credentials, a real model or real data, or that skips by default.
- A step marked done without an integration test.
- A secret or real personal data in the repository, a log or an error message.
- Plan or design text that disagrees with the code, or a stale PROGRESS.md.
- A module importing another module's internals instead of its `index.ts`.
- Model output used without schema validation.
- Anything that submits, sends or posts without an approval step in code.
