# app

The composition root, the command-line commands and the end-to-end tests. This is the only place that opens the data folder and joins the seven modules; every other module takes its dependencies as arguments.

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
