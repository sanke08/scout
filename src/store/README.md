# store

SQLite storage for jobs and the action log, the job state machine, the settings file and the kill switch. Implements `JobStore`, `ActionLog` and `SettingsStore` from `src/shared/ports.ts`.

**Owner:** the `store` agent, branch `feat/store`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/store/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `store` section of [docs/PLAN.md](../../docs/PLAN.md).

## Public interface

| Export                                                            | What it does                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `openDatabase(path)`                                              | Makes the parent folder, refuses a newer database untouched, upgrades the schema, returns it. |
| `createJobStore(database, now?)`                                  | The `JobStore`: `upsertPosting`, `get`, `list`, `transition`.                                 |
| `createActionLog(database, now?)`                                 | The `ActionLog`: `append`, `recent(limit)` newest first. Append-only.                         |
| `createSettingsStore(path)`                                       | The `SettingsStore`: `load`, `save` for one pretty-printed JSON file.                         |
| `assertNotPaused(settings)`                                       | The kill switch: throws `ScoutError("paused")` when `automationPaused` is true.               |
| `ALLOWED_TRANSITIONS`, `allowedNextStatuses`, `TERMINAL_STATUSES` | The state machine table and helpers, for callers that want to show valid next steps.          |

`now` is a `() => Date` so tests can use a fixed clock.

```ts
import { databasePath, settingsPath } from "../shared/index.js";
import {
  assertNotPaused,
  createActionLog,
  createJobStore,
  createSettingsStore,
  openDatabase,
} from "../store/index.js";

const database = openDatabase(databasePath());
const jobs = createJobStore(database);
const log = createActionLog(database);
const settings = createSettingsStore(settingsPath());

assertNotPaused(settings.load()); // call first in any module that submits or fills forms
const job = jobs.upsertPosting(posting); // new postings start as "found"
jobs.transition(job.id, "shortlisted", "score 82"); // illegal moves throw ScoutError("illegal-transition")
log.recent(10); // newest first; includes the upsert and the transition above
```

## Where data lives

- `jobs` table: one row per posting id. Columns: the whole `Posting` as JSON, plus `status`, `previous_status`, `status_reason`, `company` and `updated_at` (status, company and updated_at are indexed).
- `action_log` table: append-only rows `at`, `actor`, `action`, `job_id`, `detail`.
- `schema_version` table: one number. Upgrade steps are an ordered list in `schema.ts`; old steps are never edited.
- Every upsert and every transition writes its log line in the same SQLite transaction as the change. If either fails, neither is kept.

## State machine

The single source of truth is `ALLOWED_TRANSITIONS` in `transitions.ts`. An illegal move throws `ScoutError("illegal-transition")` whose message names both statuses and the allowed next ones.

| From           | May move to                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| `found`        | shortlisted, needs-you, failed, skipped, closed                                         |
| `shortlisted`  | resume-ready, needs-you, failed, skipped, closed                                        |
| `resume-ready` | approved, needs-you, failed, skipped, closed                                            |
| `approved`     | submitting, resume-ready, needs-you, failed, skipped, closed                            |
| `submitting`   | applied, unverified, needs-you, failed (nothing else)                                   |
| `applied`      | contacted, interviewing, rejected, withdrawn, skipped, closed                           |
| `contacted`    | interviewing, offer, rejected, withdrawn, skipped, closed                               |
| `interviewing` | offer, rejected, withdrawn, skipped, closed                                             |
| `offer`        | rejected, withdrawn, skipped, closed                                                    |
| `unverified`   | contacted, interviewing, offer, rejected, withdrawn, needs-you, failed, skipped, closed |
| `needs-you`    | the status it came from, plus skipped, closed, failed                                   |
| `skipped`      | found (undo), closed                                                                    |
| `failed`       | skipped, closed                                                                         |
| `rejected`     | none (final)                                                                            |
| `closed`       | none (final)                                                                            |
| `withdrawn`    | none (final)                                                                            |

Rules that always hold:

- `applied` is reached only from `submitting`.
- `submitting` is the submit marker. It is never left back to `approved`, so an interrupted submit is never retried blindly. A job found in `submitting` after a crash must be resolved by a person or a check (`applied`, `unverified`, `needs-you` or `failed`).
- Every non-final status except `submitting` may go to `skipped` or `closed`.
- Entering `needs-you` stores the previous status; the job may return to exactly that status.

## Settings

One JSON file, pretty-printed with two spaces, validated with `settingsSchema`. A missing file gives `DEFAULT_SETTINGS`; a missing field takes its default; an unknown field or a wrong value gives `ScoutError("invalid-input")` naming the field. Saving writes a temporary file in the same folder and renames it over the real one.

## Errors

| Situation                                              | Error                |
| ------------------------------------------------------ | -------------------- |
| Unknown job id in `transition`                         | `not-found`          |
| Move not in the table                                  | `illegal-transition` |
| Invalid posting, empty reason, bad limit, bad settings | `invalid-input`      |
| Database newer than the code, damaged stored data      | `unavailable`        |
| Automation paused (`assertNotPaused`)                  | `paused`             |

## Glossary

- **Posting**: a normalised job advert from discovery (`Posting` in `src/shared`).
- **Job record**: a posting plus its status, reason and update time (`JobRecord`).
- **Status**: where a job is in its life, one of the names in `src/shared/job-status.ts`.
- **Transition**: a move from one status to another; allowed only if the table says so.
- **Submit marker**: the `submitting` status, written before a submit starts so an interrupted submit is never repeated blindly.
- **Action log**: the append-only list of what Scout did and why.
- **Schema version**: the number stored in the database saying which upgrade steps it has had.
- **Kill switch**: the `automationPaused` setting; `assertNotPaused` turns it into an error.

## Run its tests

```
npx vitest run src/store
```

Tests use temporary folders under the system temp directory and delete them afterwards. They need no network and no real data. `node:sqlite` is loaded through `sqlite-module.ts`, which hides Node's one experimental warning.
