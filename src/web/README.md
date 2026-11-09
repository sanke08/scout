# web

The local web server and the Digest, Profile, Applications and Settings page, bound to 127.0.0.1. The approved look and behaviour is in `reference/scout-page.html` (fictional data, read-only reference).

**Owner:** the `web` agent, branch `feat/web`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/web/index.ts` exports `startWebServer(dependencies, options)`, the types `WebDependencies`, `WebServerOptions`, `RunningWebServer`, `DigestCard`, `DigestProvider`, `DigestAnswer`, `PendingProposal`, and the list `SKIP_TAGS`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `web` section of [docs/PLAN.md](../../docs/PLAN.md).

## What it is

A small HTTP server (`node:http`, no framework) that serves one page with four views and a JSON API behind it. The server holds no logic of its own: it checks input, calls the stores and the resume builder it was given, and shapes the reply. Everything it needs is passed in, so tests use fakes.

```
const server = await startWebServer(
  { profileStore, settingsStore, jobStore, resumeBuilder, digestProvider },
  { port: 4173 },
);
// server.url is "http://127.0.0.1:4173"; await server.close() stops it.
```

Optional dependencies: `agent` (the autopilot `AgentController`) and `goals` (the `GoalsStore`); without them the autopilot and goals routes answer 404 "Autopilot is not enabled."; `actions` (an `ActionRunner` behind the `/api/actions` routes, which still work but have no button on the page; without it the action routes answer 404), `healthReport` and `modelName` (the Control tab's status and model line), `platforms` (sign-in records and the keychain for the platform routes; without it they answer 404), `ledger` (the application ledger; without it the Applications routes answer 404 "Applications are not enabled."), `now` (a clock, tests inject a fixed one) and `pendingProposals` (model-written wordings waiting for approval, shown read-only on the Profile view).

## How to run it

The module has no command of its own yet; the command-line wiring that calls `startWebServer` comes with the CLI. To look at the page, start the server from a small script with fake or real stores and open the printed address. Pass `port: 0` to let the system choose a free port. The page files are read from `src/web/public/` when the server starts.

Checks: `npm run check`. The tests start a real server on a free port and talk to it over HTTP; they need no network beyond 127.0.0.1.

## Safety rules the server enforces

- Binds to `127.0.0.1` only.
- A request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` is refused with 403 (DNS-rebinding defence).
- A change request (POST or PUT) with an `Origin` header other than the server's own is refused with 403.
- Request bodies are capped at 1 MB (413), must be JSON (415 for another content type, 400 for invalid JSON), and are validated with zod; a refusal is `{ "error": "<full sentence>" }` with a proper status.
- Static files come from a fixed allow-list read at start-up; the request path is looked up in a map, never joined onto a folder, so directory traversal cannot work.
- The page sends a Content-Security-Policy (scripts only from the server itself) and never writes server text as markup.

## Routes

| Method and path                     | Body                                                     | Reply                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/`, `/styles.css`, `*.js`      | none                                                     | The page and its files (fixed list)                                                                                                                                             |
| GET `/api/health`                   | none                                                     | `{ ok: true }`; with a `healthReport` also `report` (queue sizes, needs you, model calls today), `approved` (jobs waiting for `scout apply`) and `modelName`                    |
| GET `/api/profile`                  | none                                                     | `{ profile, pendingProposals? }`                                                                                                                                                |
| PUT `/api/profile`                  | the whole profile (`profileSchema`)                      | `{ profile, version }`; the store bumps the version                                                                                                                             |
| GET `/api/settings`                 | none                                                     | `{ settings, defaults }`                                                                                                                                                        |
| PUT `/api/settings`                 | the whole settings object (`settingsSchema`)             | `{ settings }`                                                                                                                                                                  |
| GET `/api/digest`                   | none                                                     | `{ generatedAt, mode, automationPaused, skipTags, cards, needsYou, recentlyApplied }`                                                                                           |
| POST `/api/jobs/:id/approve`        | none or `{}`                                             | `{ job }`; the job becomes `approved`                                                                                                                                           |
| POST `/api/jobs/:id/skip`           | `{ tag }` (one of `SKIP_TAGS`)                           | `{ job }`; the job becomes `skipped`, the tag is the reason                                                                                                                     |
| POST `/api/jobs/:id/undo`           | none or `{}`                                             | `{ job }`; the job returns to `shortlisted`                                                                                                                                     |
| POST `/api/resume`                  | `{ keywords: string[], company?: string }`               | the `ResumeBuild` of the saved profile (LaTeX, estimates, matched and not-in-profile terms)                                                                                     |
| GET `/api/actions`                  | none                                                     | `{ running, last, lastByName }`: the action running now (name, startedAt), the latest finished result and the latest result of each action                                      |
| POST `/api/actions/:name`           | none or `{}`; `name` is `discover` or `inbox`            | 202 and the same state; 409 while another action runs or when the inbox is blocked by the kill switch; 400 when the mail variables are missing; 404 unknown name                |
| GET `/api/agent`                    | none                                                     | The `AgentState`: `running`, `task`, `startedAt`, `events` (newest 200, oldest first; model text, shown as text only) and `last` (outcome, summary, tool calls, turns)          |
| POST `/api/agent/start`             | `{ task: hunt\|inbox\|followups\|custom, instruction? }` | 202 and the state; 409 while a run goes or automation is paused; 400 when the goals are still the starter text (the controller's own sentence); 400 for an unknown task         |
| POST `/api/agent/stop`              | none or `{}`                                             | 200 and the state; safe when nothing runs                                                                                                                                       |
| GET `/api/goals`                    | none                                                     | `{ text, written }`; `written` is false while the text is the starter text                                                                                                      |
| PUT `/api/goals`                    | `{ text }`                                               | `{ text, written }`; 400 when the text is longer than the store's cap                                                                                                           |
| GET `/api/platforms`                | none                                                     | `{ platforms: [{ name, known, login, level, credentialsSaved, lastSignInAt }], keychainAvailable, warning }`; never a username or password                                      |
| PUT `/api/platforms/:name`          | `{ login?, level?, confirm? }`                           | the same list; `saved` or `auto` on linkedin, indeed or naukri needs `confirm` equal to the platform name (else 400); `saved` on an unknown site is 400, without a keychain 503 |
| GET `/api/applications`             | query: `search`, `status` (comma list), `due=1`          | `{ applications: LedgerEntry[], dueCount }`                                                                                                                                     |
| GET `/api/applications/:id`         | none                                                     | `LedgerDetail` (entry, `events` oldest first, `allowedStatuses`); 404 when not in the ledger                                                                                    |
| POST `/api/applications`            | `manualApplicationSchema`                                | 201 and the `LedgerDetail` of an application made outside Scout                                                                                                                 |
| PUT `/api/applications/:id/details` | `applicationDetailsSchema`                               | the `LedgerDetail`; an empty string clears a field                                                                                                                              |
| POST `/api/applications/:id/status` | `{ status, note?, at? }`                                 | the `LedgerDetail`; a move the ledger refuses is 409 with its sentence                                                                                                          |
| POST `/api/applications/:id/events` | `newEventSchema`, kind not `status` or `applied`         | 201 and the new history entry                                                                                                                                                   |

Saving Settings with `automationPaused` true also calls `agent.stop()`, so pausing always ends a running autopilot.

Status codes: 400 invalid input, 403 wrong host or origin, 404 unknown route or job or missing profile, 405 wrong method (with `Allow`), 409 illegal transition, 413 body too large, 415 not JSON, 500 unexpected (the cause is logged, never sent). A `ScoutError` from a store keeps its own sentence and maps by code.

## The page

Static files in `src/web/public/`: `index.html`, `styles.css`, and plain ES modules (`app.js` starts the page; `digest-view.js`, `profile-view.js`, `applications-view.js`, `settings-view.js` draw the views; `api-client.js` is the only code that calls the server; `dom.js` builds elements through `textContent` only; `highlight.js` marks keywords; `tex-preview.js` reads the resume's LaTeX back as lines for the preview sheet). Views are chosen by the address hash: `#digest`, `#control`, `#profile`, `#applications`, `#settings`. Keys on the Digest: `j` `k` move, `a` approve, `s` skip then pick a tag, `Enter` details. The page does not build resumes: it calls `POST /api/resume` (after a short pause while typing) and shows what comes back. No data is kept in the browser's own storage.

### The Control tab and the header button

`pause-control.js` draws a Pause / Resume automation button in the header on every tab. Pausing is one click; resuming asks once, inline ("Let Scout fill forms and submit again?"). Both go through `PUT /api/settings` after reading the newest saved settings. `control-view.js` is the home of autopilot (D-013: the model decides the job hunt, the owner starts, watches and pauses). It shows, top to bottom: Autopilot (a big "Start autopilot" button that runs the chosen pass, a "What should it do?" select with Find and shortlist jobs, Read my inbox, Draft follow-ups and Custom, an optional note for the model, a Stop button, the reason Start is off when automation is paused, the goals are still the starter text, a custom pass has no note, or a run is going, and the last result: outcome, the model's summary, tool calls, turns and time); the Live log (while a run goes the page asks `GET /api/agent` every 2 seconds; newest line at the bottom, the log follows it until the owner scrolls up; each line carries a word (model, tool, result, system) and a monochrome style so kinds differ without colour; every line is set with `textContent`); Goals (a textarea, "Write what you want in your own words; Scout's model reads this every run", Save, and a note that the model decides what to look for from it); Status (automation, last activity, boards, jobs by status, what needs you); the AI line ("Model: Sonnet 5.5 (your own Claude login). Last run used N turns."); Platforms (login way and apply level as selects, credentials saved and last sign-in read-only, the terminal commands `scout login <platform>` and `... --save` with Copy buttons; saved or automatic on a known platform shows the warning and enables Save only after the name is typed, and the server checks it again); and Approved and waiting (`scout apply <id>` with Copy). There is no password field anywhere: saving a password needs the terminal's keychain prompt. The start box and the log redraw only when they change, so a keyboard user's focus and the owner's scroll position survive a poll. The old "Find jobs now" and "Read inbox now" buttons are gone; `/api/actions` remains for scripts. The header Pause button, after saving, asks the Control tab to read the autopilot state again, so a pause visibly ends a run.

The Settings tab has no engine, switch-on-limit or daily model-call controls (deprecated by D-013); it has "Max turns per run" (`agentMaxTurns`, 1 to 200) and "Max minutes per run" (`agentMaxMinutes`, 1 to 240).

The runner (`action-runner.ts`) is generic: it runs a named function, keeps the result in memory (lost on restart), turns every failure into a failed result with a plain sentence, and logs only the kind of error. The real actions, the autopilot controller (`createAgentController`) and the goals store are wired in `src/app/web-dependencies.ts`.

### The Applications tab

Beside Digest, Profile and Settings, with a badge showing how many next steps are due. The top has a search box (company, role, recruiter, phone, job id, notes), a status filter, a "Due only" toggle and "Add application". The table lists Applied, Company, Role, Job ID, Status, Recruiter and Next step; on a phone the less useful columns are hidden. A row (or its company button) opens a panel with the facts and posting link (only http and https addresses become links, opened in a new tab with `noopener noreferrer`), editable recruiter and job fields with the next step and its date, a "Report status" control that offers only `allowedStatuses`, a form to log a call, email, message, interview, follow-up or note, and the history with each kind named. Server error sentences appear beside the form that caused them. Everything is built with `textContent`; nothing is kept in browser storage.

## Glossary

- **Digest:** the daily list of shortlisted jobs with approve and skip actions, plus the "needs you" block and recent applications.
- **Digest card (`DigestCard`):** one shortlisted job with its scores, reasons, unmet requirements, answers and resume text. Supplied by a `DigestProvider`.
- **DigestProvider:** a function that returns today's cards. The real one is wired later; tests use a fake.
- **Skip tag:** the short reason given when skipping a job ("Wrong location", "Too junior", "Company", "Not interested"). It is stored as the transition reason.
- **Tailor preview:** the keyword box on the Profile view and the server's answer: which keywords the profile supports and which it does not.
- **Pending proposal:** a model-written wording waiting for approval; shown read-only and changes nothing.
- **Application (ledger entry):** a job that was sent, with the recruiter, job id, next step and history kept by the ledger. The Applications tab is its view.
- **Own origin:** `http://127.0.0.1:<port>` or `http://localhost:<port>` for the running server; the only origin allowed to change data.
