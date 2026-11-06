# folders

One folder per job, the generated job board, leads files, backups, the health report and the text of the background service. Everything here works on plain files; it has no network and no model.

**Owner:** the `folders` agent, branch `feat/folders`. Only this folder (and its tests) changes in its branch.

**Public interface:** `src/folders/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** IDEA sections 5.11 (job folders and evidence), 5.12 and 5.16 (operations, backups, health).

## Folder layout

Inside the data folder (`SCOUT_DATA_DIR`), job folders live in `jobs/`:

```
jobs/
  BOARD.md                              generated table of every job and status
  2026-11-07_ExampleCorp_Backend-Engineer/
    job.md                              front matter, description, fit, log
    Alex_Rivera_ExampleCorp.tex         tailored resume source
    Alex_Rivera_ExampleCorp.pdf         tailored resume PDF
    sent/Alex_Rivera_ExampleCorp.pdf    the exact PDF sent at apply time
  2026-11-07_ExampleCorp_Backend-Engineer-A/   a second posting of the same role
```

Leads (jobs found but not yet picked) are separate dated files in a folder of the caller's choice, for example `leads/2026-11-07_greenhouse-round1.md`.

A backup is a dated folder `scout-backup-YYYY-MM-DD_HHMMSS` holding `profile.json`, `settings.json`, `scout.sqlite`, `jobs/`, `project-notes/` and a marker file `scout-backup.json`.

## Naming rules

- Folder name: `YYYY-MM-DD_Company_Role`. The date is the day the folder was created (UTC). The company is CamelCase with no punctuation (`Acme, Inc.` becomes `AcmeInc`); an unreadable company is `Unknown`. The role is a hyphenated slug of at most four words with bracketed text removed.
- A folder is **never renamed**. A later look at the same job (same job id or link) reuses the folder. A posting with no known link also reuses a folder with the same company and role.
- A different posting that gets the same name gets an ending: the recruiter name if one is given, then `-A`, `-B`, ... `-Z`, `-AA`.
- `job.md` front matter keys: `job_id`, `status`, `company`, `role`, `location`, `experience_asked`, `link`, `platform`, `posted_by`, `created`, `applied`, `resume_sent`, `resume_tailored`. Unknown values are the word `unknown`; dates are absolute.
- `job.md` sections: Job description, Fit and gaps, Resume selection, Recruiter contact, Outreach log, Interview prep, Log. The description is saved word for word the first time and never overwritten.

## Public interface

| Export                                                                                                                                                  | What it does                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createJobFolderManager({ jobsDirectory, now })`                                                                                                        | Returns `ensureJobFolder`, `findJobFolder`, `readJob`, `updateFrontMatter`, `setStatus`, `appendLogLine`, `writeSection`, `saveTailoredResume`, `recordResumeSent`. All take the folder **name**, never a path, and refuse names that leave the jobs folder. |
| `buildBoardTable(jobsDirectory)`, `writeBoardTable(jobsDirectory)`                                                                                      | Reads every `job.md` and renders the table ordered by status, then folder, with a totals line. Folders without usable front matter are listed in `skipped`.                                                                                                  |
| `writeLeadsFile(directory, source, date, rows)`, `latestLeadsFile`, `markLead`, `readLeadStatuses`                                                      | Writes `YYYY-MM-DD_<source>-roundN.md`, finds the newest, and sets a row's Status to applied, skipped or blank.                                                                                                                                              |
| `createBackup({ dataDirectory, destination, now })`, `restoreBackup({ backupDirectory, dataDirectory, overwrite })`                                     | Makes a dated backup folder; restores it, refusing a non-empty data folder unless `overwrite` is true.                                                                                                                                                       |
| `buildHealthReport({ jobStore, settings, actionLog, boardsFile, now, modelCallsToday })`, `renderHealthText`, `isHeartbeatStale(lastRunAt, now, hours)` | The status area data and its plain-text form.                                                                                                                                                                                                                |
| `renderLaunchAgentPlist({ label, programArguments, workingDirectory, logDirectory, startIntervalSeconds? })`                                            | Returns launchd XML text. It writes nothing and loads nothing.                                                                                                                                                                                               |

```ts
import { jobsDirectory } from "../shared/index.js";
import { buildHealthReport, createJobFolderManager, writeBoardTable } from "../folders/index.js";

const folders = createJobFolderManager({ jobsDirectory: jobsDirectory(), now: () => new Date() });
const folder = folders.ensureJobFolder(posting); // { name, path, created }
folders.setStatus(folder.name, "shortlisted", "score 82"); // updates job.md and adds a log line
folders.recordResumeSent(folder.name, "/tmp/Alex_Rivera_ExampleCorp.pdf"); // copies into sent/
writeBoardTable(jobsDirectory()); // refreshes BOARD.md
```

## Safety

- **Atomic writes:** every file is written to a temporary name beside the target and renamed, so a crash leaves the old file, never half a file.
- **Path safety:** folder names, resume stems and source names are checked; `..`, slashes, leading dots and control characters are refused with `ScoutError("unsafe")`.
- **Backups:** an allow list (profile, settings, database, `jobs/`, `project-notes/`). Folders named like saved sessions or browser profiles, any `.env` or `.env.*` file, and symbolic links are never copied, in a backup or a restore. The database is copied with SQLite `VACUUM INTO` through a connection to the live database, so the snapshot is consistent even while Scout runs. A destination inside the data folder is refused. A backup is built under a `.partial` name and renamed when complete.
- **Restore:** only into an empty data folder unless `overwrite` is true; with `overwrite`, files in the backup replace files of the same name and nothing else is deleted (except stale `scout.sqlite-wal` and `-shm` files next to a replaced database).

## Errors

All failures are `ScoutError`: `unsafe` (bad name, restore into a non-empty folder), `invalid-input` (bad status, bad label, missing front matter), `not-found` (no such folder, row or data folder).

## Glossary

- **Job folder**: the folder for one job, named once and never renamed.
- **Front matter**: the `key: value` block between two `---` lines at the top of `job.md`.
- **Board table**: the generated Markdown table of every job and status.
- **Lead**: a job found but not yet picked; it is a row in a leads file, not a folder.
- **Round**: one run of a source on one day; the first is round 1.
- **Heartbeat**: the time of the newest action in the log; stale means more than a day of silence.
- **Launch agent**: a macOS launchd job that starts Scout at login and restarts it after a crash.

## Run its tests

```
npx vitest run src/folders
```

Tests use temporary folders under the system temp directory and delete them afterwards. They need no network and no real data.
