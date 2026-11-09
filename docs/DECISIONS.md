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

## D-011 (2026-11-09): An application ledger, fed by the job store

Status: accepted
Context: The owner must never lose track of an application: who the recruiter is, the job id and link, and what happened after (calls, rejections), including applications made outside Scout.
Options: A parse the action log and `job.md` files when asked; B tables for details and history, written by a wrapper around the job store; C a hand-edited Markdown file.
Choice: B. The wrapper means every status change from anywhere is recorded. `APPLICATIONS.md` is generated from the tables and never edited by hand. A user-reported status goes through the state machine by legal steps only.
Consequences: Schema version 3. History before this change is not back-filled. The same data is shown on the command line and the Applications page.

## D-012 (2026-11-09): Two ways to sign in, chosen per platform

Status: accepted
Context: Earlier, Scout never typed a password. The owner wants a choice per platform: sign in by hand (session reused) or let Scout sign in with credentials stored securely, and to change it at any time.
Options: A manual only; B manual or saved credentials, per platform, opt-in; C always saved.
Choice: B, default manual. Credentials live only in the OS keychain; Scout never receives the password while saving, never logs it and never sends it to a model. Auto sign-in happens once per run and at most once per six hours, only on the platform's own domain, and stops at any CAPTCHA, one-time code or checkpoint. Choosing saved credentials or Automatic for LinkedIn, Indeed or Naukri needs a typed confirmation because automating those sites may break their terms and risk the account.
Consequences: This supersedes the "Scout never types a password" rule in the idea document for platforms set to saved. Submitting is unchanged: kill switch, typed yes, daily limit, never twice.

## D-013 (2026-11-09): Autopilot: the model decides, Scout offers tools

Status: accepted (supersedes D-006 and D-009 for autopilot; the single-shot Brain stays for notes and interview plans)
Context: The owner wants Scout to be a start/pause surface only. Filtering, shortlisting, tailoring and what to do next must be decided dynamically by the model, not by predefined rules. Only Sonnet 5.5 is used.
Options: A keep code rules with the model at the edges; B give the model tools and let it run the whole job; C both.
Choice: B for the job hunt. `scout mcp` serves Scout's capabilities as tools; `scout agent run` starts `claude -p --model claude-sonnet-5-5` with only those tools (plus web search and fetch) and watches the run. The owner's wishes are free text (goals), not rules. Hard rules, keyword scoring and the score threshold are no longer used by autopilot. Codex and engine switching are removed.
What code still enforces (data integrity and the owner's own controls, not filters): the pause switch on every tool call; the apply level per platform (Prepare only, Fill I submit, Automatic) with the owner's choice that on Automatic the model submits without a typed yes; the state machine and submitted-once; the fact check on resume wording; untrusted text kept apart from instructions; no secret ever reaches the model.
Verified 2026-11-09: `claude -p --model claude-sonnet-5-5 --mcp-config F --strict-mcp-config --allowedTools "mcp__scout__*" --tools "" --max-turns 4 --output-format stream-json --verbose` called a stdio MCP tool and used its result without a permission prompt.
Consequences: More autonomy means the live run log and the pause switch matter more. Every tool call is logged. Cost is the owner's Claude usage; a turn limit per run is a setting.

D-013 addendum (2026-11-09, after two adversarial reviews): the web tools are allowed only for the hunt task (and custom with `--web`), WebFetch is limited to the board hosts the owner watches, and the model cannot add feed boards. Fill level hands the open form to a separate detached helper (`scout apply-keep-open`) that records the outcome after the owner submits; a "waiting for the owner" state is a private record the model cannot write. Questions about age, date of birth, caste, nationality, salary and similar, and anything the owner set to "ask each time", always go to the owner. The daily limit is claimed atomically with the submit marker, by one shared count, from every path.
