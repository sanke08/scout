# Progress

Updated by the orchestrator when a branch is merged.

## Current

Wave 0 (foundation) is done. Wave 1 modules are in progress in parallel.

## Phase status

| Phase                           | Status      |
| ------------------------------- | ----------- |
| Wave 0: foundation              | done        |
| Wave 1: seven modules           | in progress |
| Wave 2: wiring, apply, tracking | not started |

## Module status

| Module    | Branch         | Status      |
| --------- | -------------- | ----------- |
| store     | feat/store     | in progress |
| profile   | feat/profile   | in progress |
| resume    | feat/resume    | in progress |
| brain     | feat/brain     | in progress |
| discovery | feat/discovery | in progress |
| decide    | feat/decide    | in progress |
| web       | feat/web       | in progress |

## Not built yet (not claimed to work)

Form adapters and applying, mailbox tracking, platform alerts, interview preparation, launchd service, backups, project reading with the model, CLI wiring of the modules.

## Done entries

Written when a module is merged: date, what was built, what the checks actually printed.

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
