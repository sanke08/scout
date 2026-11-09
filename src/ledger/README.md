# ledger

The record of every application: which job, its link and the company's own job id, who the recruiter is (name, firm, email, phone), what happened since (calls, emails, interviews, notes, every status change) and what to do next. It also keeps `APPLICATIONS.md` in the data folder up to date, so the whole record can be opened, searched or printed without Scout running.

**Public interface:** `src/ledger/index.ts`. Other modules import only from there.

## How it works

- **Scout's own submits are recorded automatically.** `withLedger` wraps the job store, so every status change anywhere in Scout (apply, inbox tracking, the Digest, the command line) writes a history line and refreshes the file. A new feature cannot forget to do it.
- **Applications made elsewhere are recorded by the user**: `scout applications add` or the Applications page. The job is created as `applied` through the same legal steps, on the date given.
- **A status the user reports** (`rejected`, `offer`, `interviewing`, `withdrawn`...) is reached only by legal steps of the state machine. Reporting `offer` from `applied` records `applied -> contacted` and `contacted -> offer`; a move no chain of legal steps reaches is refused with the list of what can be reported. A sent application can never be skipped or reopened.
- **History is only ever added to.** A call can be back-dated (`--on 2026-11-08`); the history is shown in time order.
- **Details** (recruiter, job id, applied via, next step and date) are replaced field by field; an empty value clears a field.
- **Finding the application when someone calls**: `scout applications find <words>` looks in company, role, recruiter name, phone, email, job id, link and every history line. All words must match.
- **The ledger file never blocks a change.** The database is the source of truth. If `APPLICATIONS.md` cannot be written, the change stands and an `ledger-file-failed` line goes to the action log; `scout applications export` rebuilds it.

## Where the data lives

Two tables in `scout.sqlite` (schema version 3): `application_details` (one row per job) and `application_events` (the history). `APPLICATIONS.md` is generated from them and may be deleted at any time.

## Files

| File                 | What it does                                                           |
| -------------------- | ---------------------------------------------------------------------- |
| `ledger.ts`          | The service: list, get, add, report status, log, save details, render. |
| `ledger-store.ts`    | The SQL for the two tables.                                            |
| `with-ledger.ts`     | Hooks every status change into the ledger.                             |
| `status-path.ts`     | Finds the legal steps to a status the user reports.                    |
| `job-number.ts`      | Works out the company's job id from a posting address.                 |
| `render-markdown.ts` | Builds the text of `APPLICATIONS.md`.                                  |
| `types.ts`           | The shapes and their zod schemas.                                      |

## Known limits

- The company job id is a guess from the link (Greenhouse, Lever, SmartRecruiters, common query parameters); the user can correct it.
- A job `unverified` after a submit cannot be changed to `applied` by the user, by design (`applied` always means a confirmed submit). Report what happened next (`contacted`, `interviewing`, `rejected`) instead.
- History made before this module existed is not back-filled; only changes from now on are recorded.
