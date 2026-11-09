# Progress

Updated by the orchestrator when a branch is merged.

## Current

All waves are merged on `main`: 12 modules, wired into the command line. An independent review (Fable) found two blockers, both fixed with tests; a second review is the next check.

## Phase status

| Phase                                          | Status        |
| ---------------------------------------------- | ------------- |
| Wave 0: foundation                             | done          |
| Wave 1: seven modules                          | done (merged) |
| Wave 2: app, apply, tracking, insight, folders | done (merged) |

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

- **2026-11-07 folders:** job folders, board table, leads, backups, health, launchd plist text. 621 tests at merge.
- **2026-11-07 app:** composition root, ten commands, discovery pass with degraded mode, digest provider, end-to-end tests through the real entry point. 691 tests at merge; the built program was run for init, profile validate, resume, boards add, jobs, pause.
- **2026-11-07 insight:** repository reader, project note writer, hold-only drafts, authored-commit filter, interview plan. 738 tests at merge. Not tried against a real model or real repository.
- **2026-11-07 tracking:** read-only mail reader, rules classifier, matcher, follow-up drafts, alert parsers, funnel, recruiter contact helpers. 850 tests at merge after removing a test that opened a loopback socket. The IMAP connection and the alert formats are untested against real mail.
- **2026-11-07 apply:** form snapshot, field mapping, dry-run engine, evidence, Playwright driver. 956 tests at merge. The Playwright driver has never run against a real browser; the form fixtures are fictional.

- **2026-11-07 wave 3:** folders wired (job folder on first shortlist, board, status, backup, restore, leads, service plist, resume --job), mail and notes wired (notes, interview, inbox, followups, funnel), apply wired (approve, skip, undo, apply, self-test with a typed `yes` before any automatic submit; no flag skips it). 1053 tests at merge.
- **2026-11-07 review fixes:** a job submitted once can never be skipped or re-opened (schema 2 `ever_submitted`); the digest's approve and undo are legal in the real state machine and covered by an end-to-end test; the model prompt travels on stdin with a 1,000,000-character cap and was verified with one real Claude call; saving a profile refuses a variant using a term outside its point's allowed list.

## Not built yet (not claimed to work)

Everything is reachable from the command line and tested with fakes. Nothing has been run against a real browser (the Playwright driver and the keep-the-window-open flow), a real mailbox, a real model on a real repository, or a live application form. The adapter self-test is not scheduled daily, and `recordResumeSent` is not called after a submit yet.

## Done entries

Written when a module is merged: date, what was built, what the checks actually printed.

- **2026-11-07 store:** SQLite jobs, action log, state machine, settings file. `npm run check` printed 67 tests passing at merge. Follow-up: a submitted job can no longer be skipped (skip-then-undo could resend an application).
- **2026-11-07 profile:** profile store, point helpers, proposals, project-note parser, first-run checks. 123 tests at merge. Follow-ups: approving the same proposal twice adds one wording; fixture terms match their variants.
- **2026-11-07 decide:** hard rules, keyword ranking, scoring shapes. 195 tests at merge. Cooldown and blacklist are given to `createDecider(context)`, not the shared port.
- **2026-11-07 resume:** one-page builder, compile helper, smoke script. 253 tests at merge. `npm run smoke:resume` compiled all ten test resumes to one page with real pdflatex.
- **2026-11-07 brain:** command bridge, router, budget, cache, fake brain, claim check. 340 tests at merge. The Claude Code flags were checked against the installed tool and one real call returned the expected JSON.
- **2026-11-07 discovery:** six board parsers, feed reader, normaliser, dedupe, flags. 476 tests at merge. `npm run smoke:discovery` against real public boards: Greenhouse, Ashby, SmartRecruiters and Lever parsed; Workable and Recruitee tokens tried did not exist, so those two parsers are unchecked against live feeds. The response size cap was raised to 25 MiB after a real Lever board exceeded 5 MiB.
- **2026-11-07 web:** local server and Digest, Profile, Settings page. 563 tests at merge. The engineer checked it in a real browser pane (digest keys, profile edit and save, settings save, no console errors); light theme and phone width were not checked.
- **2026-11-09 ledger and platforms:** application ledger (recruiter, job id, link, history, next step, `APPLICATIONS.md`), `scout applications` commands, the Applications tab, and per-platform sign-in (by hand or saved in the OS keychain) with `scout platforms`, `scout login` and `scout logout`. 1161 tests. Not run against a real browser, keychain or site; the login addresses for LinkedIn, Indeed and Naukri are best guesses. History before this change is not back-filled.

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
