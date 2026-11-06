# app

The composition root, the command-line commands and the end-to-end tests. This is the only place that opens the data folder and joins the modules; every other module takes its dependencies as arguments.

**Owner:** the `app` agent, branch `feat/app`. Only `src/app/`, `src/index.ts`, `src/index.test.ts` and `test/` change in its branch.

**Public interface:** `src/app/index.ts`. `src/index.ts` imports only from there.

## What it is

- `createApplication(options)` opens the data folder (creating it), the SQLite database, the settings, job, action-log, profile and proposal stores, the resume builder, discovery, the board list and the score file. Every part can be replaced through `options`, so tests pass a fake network, a `FakeBrain` and a fixed clock. `close()` closes the database.
- The **brain** is built on first use (`application.brain()`), because its router needs the profile version and `scout init` must work before any profile exists. The main engine comes from `settings.mainEngine`; the other engine is the fallback only when `settings.switchEngineOnLimit` is on. The budget (`model-budget.json`) and cache (`brain-cache/`) live in the data folder.
- The **decider** is rebuilt on each call (`application.decider()`) from the stored applications, so the cooldown list is current. Cooldown is 14 days (`COOLDOWN_DAYS`; no setting exists for it yet).
- `runDiscoveryPass(application)` is the whole funnel: read each board, merge duplicates, apply the hard rules (every dropped posting is stored as `skipped` with its reasons), save the survivors as `found`, then shortlist. It returns a `DiscoveryPassSummary`.
- `createDigestProvider(application)` makes the Digest cards from shortlisted jobs, each with a resume built for that job. `createWebDependencies(application)` joins everything `startWebServer` needs, including the pending proposals.

## How shortlisting works

1. Candidates are the `found` jobs with no model score for the current profile version, ranked by keyword score; at most 40 go to the model in one pass (`SCORING_CANDIDATES_PER_PASS`), in requests of at most 20.
2. Each reply is combined into one shortlist score. At or above `minimumShortlistScore` the job becomes `shortlisted`; up to 15 points below it (or with an unknown hard requirement) it stays `found` for review; lower it is `skipped` with the model's reason.
3. A score is stored in `scores.json` by posting id and profile version, so a job is never sent to the model twice for the same profile. (The brain's own cache is keyed by a whole batch and would miss when batches change.)
4. **Degraded mode:** if the model reports its limit (or the daily budget is spent) or cannot be run, the remaining candidates are shortlisted on keyword score alone, only at 60 or more and at most 10 of them. The summary says `mode: "degraded"` and why, and `scout discover` prints it in capitals. Jobs left unscored wait for the model and are scored on a later pass. A reply in the wrong shape does not degrade the pass; those jobs stay `found` with a note.
5. Discovery does not act on the user's behalf, so the kill switch does not stop it. Acting steps call `application.assertNotPaused()` first.

## Commands

| Command                                                                   | What it does                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `scout init`                                                              | Creates the data folder and settings; copies the fictional sample profile only if there is none; prints next steps |
| `scout profile show`                                                      | Prints a short profile summary                                                                                     |
| `scout profile validate`                                                  | Checks the file is valid and complete; lists what is missing                                                       |
| `scout resume --keywords "a,b" --company X [--compile] [--out DIR]`       | Builds a one-page resume, writes the `.tex`; with `--compile` also runs `pdflatex` and reports the pages           |
| `scout boards add <kind> <token>` or `scout boards add <careers address>` | Adds a board (`--company NAME` optional)                                                                           |
| `scout boards remove <kind> <token>`                                      | Stops watching a board                                                                                             |
| `scout boards list`                                                       | Shows watched boards                                                                                               |
| `scout discover`                                                          | One discovery pass; prints the summary                                                                             |
| `scout jobs [--status S]`                                                 | Lists jobs with the reason for each status                                                                         |
| `scout digest [--resume]`                                                 | Prints shortlisted jobs, best first                                                                                |
| `scout serve [--port N]`                                                  | Starts the web page on 127.0.0.1 (default port 4173); Ctrl-C stops it                                              |
| `scout pause` / `scout unpause`                                           | Turns the kill switch on or off                                                                                    |
| `scout version`                                                           | Prints the version                                                                                                 |

A `ScoutError` is printed as its message and sets the exit code from `src/shared/errors.ts` (for example 3 for not found, 7 for paused). A usage mistake keeps the parser's own message and exit code 1.

## Job folders and operations commands

Job folders (`<data folder>/jobs/`, the `folders` module) follow the store in one direction only: the store owns a job's status, `job.md` copies it. A job gets its folder the first time it becomes `shortlisted`, with the description saved word for word; each later status change sets `status` in `job.md` and adds a Log line. A job that was never shortlisted (found, or skipped by a rule) has no folder. This happens inside `application.jobStore.transition`, so every command that moves a job is covered. If the folder cannot be written, the store change stands and the failure is recorded in the action log as `folder-sync-failed`. `application.folders`, `application.syncJobFolder(id)` and `application.healthReport()` are available to commands; tests may pass `folders` to `createApplication`.

| Command                                                     | What it does                                                                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout resume --job <jobId> [--keywords "a,b"] [--compile]` | Builds the resume from the job's skills plus any given keywords and saves `.tex` (and `.pdf`) in the job's folder; records `resume_tailored`; no status change. `--out` is refused with `--job` |
| `scout board`                                               | Writes `jobs/BOARD.md` and prints the count per status and the total                                                                                                                            |
| `scout status`                                              | Plain-text health report: pause flag, heartbeat, model calls used today (from `model-budget.json`), jobs by status, jobs needing you, boards watched                                            |
| `scout backup --to DIR`                                     | Dated backup of profile, settings, database, `jobs/` and `project-notes/`; never sessions, `.env` files or links; DIR must be outside the data folder                                           |
| `scout restore --from DIR [--overwrite]`                    | Restores a backup; refuses a data folder that already has files unless `--overwrite`                                                                                                            |
| `scout leads add --from FILE [--source NAME]`               | Writes `leads/YYYY-MM-DD_<source>-roundN.md` from a JSON list of `{ company, role, link?, location?, experience?, listedSkills?, missing?, notes? }`                                            |
| `scout leads list [--source NAME]`                          | Prints the newest leads file                                                                                                                                                                    |
| `scout service plist [--program PATH]`                      | Prints the launchd property list on standard output and the manual install steps on standard error. Writes and loads nothing                                                                    |

`backup`, `restore`, `leads` and `service` do not open the application (opening creates the database, which would make a restore into a fresh folder look non-empty).

## Mail, notes and interview commands

Registered by `registerMailAndNotesCommands` (one line in `src/index.ts`). Scout never sends mail, never deletes it and never marks it as read.

| Command                                            | What it does                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout notes write <repoFolder> [--force]`         | Reads the project once (`readRepository`), asks the brain for a note, writes `<data>/project-notes/<folder>.md`; prints the verdict, dropped terms and figures, and the do-not-claim list. Refuses to overwrite without `--force`; the refusal costs no model call                                                     |
| `scout notes list`                                 | Lists the saved notes with verdict and stack                                                                                                                                                                                                                                                                           |
| `scout notes draft`                                | Prints draft profile points from the notes, all on `hold`. Never saves into the profile                                                                                                                                                                                                                                |
| `scout interview <jobId> [--save] [--no-model]`    | Prints the interview plan for a stored job. Resume points: the `.tex` saved in the job's folder, else a resume built from the profile for the job's skills. `--save` writes it into the job folder's "Interview prep" section if that folder exists, else to `<data>/interview/<jobId>.md` (and says so)               |
| `scout inbox [--since YYYY-MM-DD] [--folder NAME]` | Reads the mailbox read-only, classifies and matches each message, applies legal status moves, prints what changed, what was an illegal move (reported, not forced) and what matched nothing. Job-alert emails are printed as leads with their official board when a watched board names the company; no job is created |
| `scout followups`                                  | Lists applied jobs with no reply for `followUpAfterDays` and prints a draft for each. Never sends                                                                                                                                                                                                                      |
| `scout funnel`                                     | Prints the funnel (discovered, shortlisted, applied, replied, interviewing, offered) by source and posting age                                                                                                                                                                                                         |

**Mailbox credentials** come only from the environment: `SCOUT_IMAP_HOST`, `SCOUT_IMAP_USER` and `SCOUT_IMAP_PASSWORD`. Use an app-specific password. On macOS you can take it from the Keychain: `export SCOUT_IMAP_PASSWORD="$(security find-generic-password -s scout-imap -w)"`. Scout itself never stores it and never prints it. If any variable is missing, the command stops with a message that names the missing ones.

**Tests** inject a fake mailbox through `ApplicationOptions.mailboxConnector` and a plain object through `ApplicationOptions.environment`; see `test/mail-notes.e2e.test.ts`.

## Apply commands

| Command                                                                         | What it does                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout approve <jobId>`                                                         | `resume-ready` to `approved`. Makes the job eligible; never submits.                                                                                                      |
| `scout skip <jobId> [--tag TAG]`                                                | Skips a job that was not submitted yet; the tag (default "Not interested") is the recorded reason.                                                                        |
| `scout undo <jobId>`                                                            | `approved` back to `resume-ready`, `skipped` back to `found`, `needs-you` back to where it came from.                                                                     |
| `scout apply <jobId> [--url URL] [--dry-run] [--profile-dir DIR] [--wait SECS]` | Kill switch, plan, then the board's level (Settings): Prepare stages only (no browser); Fill opens a visible browser and you press submit; Automatic needs a typed `yes`. |
| `scout apply self-test <fixtureOrUrl> [--board KIND] [--profile-file FILE]`     | A dry run on a saved page or stable posting; records the result in `board-runs.json`.                                                                                     |

Rules the commands keep: the kill switch is checked first; a job must be `resume-ready` or `approved` (a job left in `submitting` is refused and never retried); at Automatic the summary is shown and only a typed `yes` allows the final click (there is no flag that answers for you); a board whose latest self-test failed is held at Fill, I submit; the resume comes from the job folder's tailored PDF, else it is built and compiled into `resumes/` (a missing `pdflatex` is reported and stops the command); evidence goes to `<jobs>/<job folder>/evidence/`, else `evidence/<job id>/`; after you press submit in Fill, `applied` is recorded only when the page shows a confirmation, otherwise `unverified` (`--wait 0` skips waiting and leaves the job unchanged). `board-runs.json` (`{ "schemaVersion": 1, "boards": { "greenhouse": { "cleanDryRuns": 1, "lastCleanRunAt": "...", "lastFailedAt": "..." } } }`) is app-owned; it changes only after a clean dry run or a self-test. The real browser path is untested against a real browser; the tests use the apply module's fake driver.

## Data folder layout

`SCOUT_DATA_DIR`, or `./data`. Git-ignored.

| File or folder                      | Owner module | Content                                                         |
| ----------------------------------- | ------------ | --------------------------------------------------------------- |
| `profile.json`                      | profile      | The editable profile                                            |
| `settings.json`                     | store        | Settings, defaults for missing fields                           |
| `scout.sqlite`                      | store        | Jobs and the action log                                         |
| `boards.json`                       | app          | `{ "schemaVersion": 1, "boards": [{ kind, token, company? }] }` |
| `scores.json`                       | app          | Model scores by posting id and profile version                  |
| `proposals.json`                    | profile      | Model-written wordings waiting for approval                     |
| `model-budget.json`, `brain-cache/` | brain        | Today's call count and remembered replies                       |
| `resumes/`                          | app          | `.tex` (and `.pdf`) files written by `scout resume`             |

## Testing

- Unit tests sit next to the code (`*.test.ts`) and use a fake discovery and a scripted brain.
- End-to-end tests in `test/` run the real `main(argv, overrides)`: `init`, `boards`, `discover` (fake network serving `fixtures/boards`, a scoring stand-in for the model), `jobs`, `digest`, `resume`, `serve` (real server on port 0), `pause`, the degraded-mode run and the hard-rule-drop record. `main`'s second argument carries the test overrides; the real program passes none.

## Glossary

- **Composition root:** the one place that builds the real parts and passes them to the code that uses them.
- **Pass:** one run of `runDiscoveryPass`.
- **Hard rule:** a model-free filter (location, seniority, salary and so on); its reasons are always stored.
- **Shortlist score:** the model's eligibility and desirability combined into 0 to 100.
- **Review band:** a score just under the threshold, or with an unknown hard requirement; the job stays `found`.
- **Degraded mode:** working without the model; keyword score alone decides, and the summary says so.
- **Kill switch:** `settings.automationPaused`; acting steps refuse to run while it is on.
