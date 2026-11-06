# Design

Template followed: the owner's plan-and-build template, version 1.8, adapted for a parallel build (see D-003). Product design: [IDEA.md](IDEA.md).

## Parameters

| Item               | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| Language           | TypeScript (strict, ESM) on Node.js 24 or newer               |
| Platforms          | macOS (Apple Silicon) first; Linux expected to work           |
| Test, lint, format | Vitest, ESLint (typescript-eslint), Prettier                  |
| CI                 | GitHub Actions: typecheck, lint, format check, test, build    |
| Commit convention  | Short imperative subject; attribution line at the end         |
| One-command checks | `npm run check` (all gates), `npm run dev -- <command>` (run) |

## Scope

Goals, non-goals and scenarios A to P are in [IDEA.md](IDEA.md) (sections 4 and 6). In this repository:

- **Built:** shared contracts, store, profile, resume, brain, discovery, decide, web, app (commands), folders, insight, tracking, apply, and the command-line wiring of all of them.
- **Not verified yet:** anything that needs a real browser, mailbox, live form or real model on a real repository. [PROGRESS.md](PROGRESS.md) lists exactly what was and was not run.

## Architecture

```
          +-----------+       +-----------+
 CLI ---> |           | <---- |  web UI   |
          |  modules  |       +-----------+
          |           |
          | store      SQLite jobs, state machine, action log, settings
          | profile    editable profile file, versions, validation
          | resume     profile + keywords -> one-page LaTeX
          | brain      Claude Code / Codex bridge, budget, cache, claim check
          | discovery  job boards -> normalised postings
          | decide     hard rules, keyword ranking
          +-----------+
                |
           src/shared  (types, ports, errors, paths, logger)
```

- **Ports** (`src/shared/ports.ts`) are the only way modules talk. A module imports another module only through its `index.ts` or the shared port types.
- **The entry layers** (CLI, web) hold only parsing, printing and HTTP; every operation lives in a module.
- **The model never acts.** `Brain` returns validated data. Only Scout's own code touches files, the network or the browser.

## State

| State                 | Where                           | Format                                                |
| --------------------- | ------------------------------- | ----------------------------------------------------- |
| Profile               | `$SCOUT_DATA_DIR/profile.json`  | JSON, `schemaVersion` 1, editable by hand             |
| Settings              | `$SCOUT_DATA_DIR/settings.json` | JSON, defaults fill missing fields                    |
| Jobs, action log      | `$SCOUT_DATA_DIR/scout.sqlite`  | SQLite, `schema_version` table, upgrade steps in code |
| Job folders, evidence | `$SCOUT_DATA_DIR/jobs/<id>/`    | plain files                                           |

Each fact is stored in exactly one place. Upgrade rule: a file with a newer `schemaVersion` than the code is refused untouched; an older one is upgraded in code with a test.

## Cross-cutting

- **Errors:** `ScoutError` with a code and a full-sentence message; exit codes in `src/shared/errors.ts`.
- **Logging:** `createLogger(scope)`; JSON lines on stderr; secrets redacted by key name.
- **Config:** `SettingsStore`; one store for the Settings view and the config file.
- **Time and randomness:** injected (`now`), so tests are deterministic.
- **Kill switch:** `Settings.automationPaused`; any module that acts checks it first and throws `ScoutError("paused")`.

## Threat model

- **Assets:** the user's profile, real contact details, saved sessions, the mailbox.
- **Untrusted input:** job postings, web pages, emails, model output.
- **Defaults:** model output is parsed against a schema and rejected otherwise; posting text is passed as data in a separate field; every parser of untrusted input has size limits; nothing is submitted without an approval step in code.
- **Secrets:** never in the repository, logs or errors; fixtures are fictional; real data is in the git-ignored data folder; CI will scan for secrets.
- **Not trusted to be correct:** the page-fit estimate (the compiled page count is the proof), the model's scores (calibrated on a labelled set).

## Dependencies

Each has one reason; all are pinned by the lockfile.

| Package              | Reason                                         |
| -------------------- | ---------------------------------------------- |
| commander            | CLI parsing                                    |
| zod                  | schemas for files, model replies and API input |
| cheerio              | read HTML of job pages and saved forms         |
| fast-xml-parser      | read RSS feeds                                 |
| imapflow, mailparser | read-only mailbox access (wave 2)              |
| playwright-core      | drive a browser for form filling (wave 2)      |

SQLite comes from Node's built-in `node:sqlite` (D-002): no native build step.

## Testing approach

Unit tests for pure logic; integration tests with fixtures for anything touching files or SQLite; no test uses the network, a real model or real data. Parsers of untrusted input are tested with malformed and hostile input. Compiling a resume with `pdflatex` is a separate smoke target (`npm run smoke:resume`, added by the resume module), not a skipping test.
