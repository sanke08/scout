# Decisions

Append-only. A changed decision is a new record that supersedes the old one.

## D-001 (2026-11-07): TypeScript on Node.js

Status: accepted
Context: The owner asked for Node.js and TypeScript. The idea document left the language open (Python by default).
Options: A Python; B TypeScript on Node.js.
Choice: B. One language for the CLI, the local web page and the browser automation; strong types for the shared contracts.
Consequences: Document generation and email handling use Node libraries; LaTeX is run as an external program.

## D-002 (2026-11-07): SQLite through `node:sqlite`

Status: accepted
Context: Jobs and the action log need a durable local store with transactions.
Options: A `better-sqlite3` (native build); B Node's built-in `node:sqlite`; C JSON files.
Choice: B. It works on Node 24 and newer with no native build, so a fresh clone installs without a compiler.
Consequences: The module is marked experimental by Node; all use is behind `JobStore` so it can be swapped.

## D-003 (2026-11-07): Contracts first, then parallel modules

Status: accepted
Context: Seven people (agents) build at once; the milestones in the idea document depend on each other.
Options: A build in milestone order one at a time; B freeze shared types and ports, build modules in parallel.
Choice: B. `src/shared` is written first and frozen; each module owns one folder; the orchestrator merges branches to `main`.
Consequences: Faster; ports may need a decision record to change; `docs/*` and `package.json` are edited only by the orchestrator during wave 1.

## D-004 (2026-11-07): Resume is LaTeX compiled with `pdflatex`

Status: accepted
Context: The owner's proven resume system uses one fixed LaTeX template with stretchable spacing.
Options: A HTML to PDF; B the existing LaTeX template.
Choice: B, preamble unchanged. The generator runs without a model; compiling is an optional local step.
Consequences: The user needs LaTeX installed to get a PDF; the page-fit estimate is only a guide.

## D-005 (2026-11-07): Real data never enters the repository

Status: accepted
Context: The repository is public.
Choice: Real data lives in `SCOUT_DATA_DIR` (git-ignored). Fixtures use a fictional person and `example.com`. A test asserts the fixture email is on `example.com`.
Consequences: Contributors start from `fixtures/profile.sample.json`.

## D-006 (2026-11-07): Model replies are data, validated

Status: accepted
Context: Claude Code and Codex are called as commands and their output is text.
Choice: Every request carries a zod schema; invalid output is retried once, then returned as a failure value. Posting text is passed in a separate `untrustedText` field.
Consequences: Callers must handle `ok: false` and degrade; the model can never trigger an action.

## D-007 (2026-11-07): A submitted job can never be skipped

Status: accepted
Context: `skipped` can be undone to `found`, so skipping an applied job and undoing would let it be applied for again.
Choice: `applied`, `contacted`, `interviewing`, `offer` and `unverified` cannot move to `skipped`; use `withdrawn` or `closed`.
Consequences: The digest's skip action only applies to jobs before `submitting`.

## D-008 (2026-11-07): Cooldown and blacklist enter through `createDecider(context)`

Status: accepted
Context: The shared `Decider` port has three arguments and no room for recent applications or a blacklist.
Choice: Pass them to `createDecider({ blacklist, cooldown })`; the port stays unchanged.
Consequences: Callers must build the decider with that context; wiring does this.

## D-009 (2026-11-07): Model engines are called with tools off

Status: accepted
Context: Scout needs text and JSON from Claude Code and Codex, never file edits.
Choice: Claude runs with `--tools ""` and `--no-session-persistence`; Codex runs with `--sandbox read-only`. Flags verified against the installed tools on 2026-11-07.
Consequences: If the tools change their flags, only `src/brain/engines.ts` changes.

## D-010 (2026-11-07): Live feed formats are checked by a smoke script, not in tests

Status: accepted
Context: Parsers were written from fixtures; real feeds can differ.
Choice: `npm run smoke:discovery` fetches real public boards and is never part of `npm test`. The body size cap is 25 MiB.
Consequences: Workable and Recruitee are unchecked against live feeds until a real token is tried.
