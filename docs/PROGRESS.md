# Progress

Updated by the orchestrator when a branch is merged.

## Current

Wave 0 (foundation) and wave 1 (seven modules) are merged on `main`. Wave 2 (wiring, apply, tracking, project insight, job folders) is in progress.

## Phase status

| Phase                           | Status      |
| ------------------------------- | ----------- |
| Wave 0: foundation              | done        |
| Wave 1: seven modules           | in progress |
| Wave 2: wiring, apply, tracking | not started |

## Module status

| Module    | Branch         | Status |
| --------- | -------------- | ------ |
| store     | feat/store     | merged |
| profile   | feat/profile   | merged |
| resume    | feat/resume    | merged |
| brain     | feat/brain     | merged |
| discovery | feat/discovery | merged |
| decide    | feat/decide    | merged |
| web       | feat/web       | merged |

## Not built yet (not claimed to work)

Being built in wave 2: CLI wiring and the end-to-end run, form adapters and applying, mailbox tracking and platform alerts, project reading and interview preparation, job folders, backups and health. Until they merge, none of them works.

## Done entries

Written when a module is merged: date, what was built, what the checks actually printed.

- **2026-11-07 store:** SQLite jobs, action log, state machine, settings file. `npm run check` printed 67 tests passing at merge. Follow-up: a submitted job can no longer be skipped (skip-then-undo could resend an application).
- **2026-11-07 profile:** profile store, point helpers, proposals, project-note parser, first-run checks. 123 tests at merge. Follow-ups: approving the same proposal twice adds one wording; fixture terms match their variants.
- **2026-11-07 decide:** hard rules, keyword ranking, scoring shapes. 195 tests at merge. Cooldown and blacklist are given to `createDecider(context)`, not the shared port.
- **2026-11-07 resume:** one-page builder, compile helper, smoke script. 253 tests at merge. `npm run smoke:resume` compiled all ten test resumes to one page with real pdflatex.
- **2026-11-07 brain:** command bridge, router, budget, cache, fake brain, claim check. 340 tests at merge. The Claude Code flags were checked against the installed tool and one real call returned the expected JSON.
- **2026-11-07 discovery:** six board parsers, feed reader, normaliser, dedupe, flags. 476 tests at merge. `npm run smoke:discovery` against real public boards: Greenhouse, Ashby, SmartRecruiters and Lever parsed; Workable and Recruitee tokens tried did not exist, so those two parsers are unchecked against live feeds. The response size cap was raised to 25 MiB after a real Lever board exceeded 5 MiB.
- **2026-11-07 web:** local server and Digest, Profile, Settings page. 563 tests at merge. The engineer checked it in a real browser pane (digest keys, profile edit and save, settings save, no console errors); light theme and phone width were not checked.

## Risk register

| Risk                                          | Mitigation                                                                 | Owner        |
| --------------------------------------------- | -------------------------------------------------------------------------- | ------------ |
| Seven branches change a shared file           | Shared files frozen; one owned folder per module; orchestrator merges      | orchestrator |
| `node:sqlite` is experimental                 | Wrapped behind `JobStore`; replaceable without touching callers            | store        |
| Page-fit estimate is wrong                    | The compiled page count is the proof; estimate calibrated on a real resume | resume       |
| Model usage limit stops scoring               | Degraded mode and engine fallback                                          | brain        |
| Real personal data leaks into the public repo | Fictional fixtures only; data folder git-ignored; test checks the fixture  | all          |

## Mismatch notes

None yet.
