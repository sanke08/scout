# Plan

Build order follows [IDEA.md](IDEA.md) section 8. Modules are built in parallel because the contracts in `src/shared/` are fixed first (D-003).

## Wave 0: foundation (orchestrator)

- Repository, CI, tooling, `src/shared` contracts, fictional fixture, `version` command with a test, docs.
- **Verify:** `npm run check` passes; `scout version` prints the package version; the sample profile validates.

## Wave 1: seven modules in parallel

Each module is one feature set with its own folder, README, tests and fixtures. Non-goals apply to every module: no network in tests, no real data, no new dependencies, no edits outside the owned folder.

### store (`src/store`) — milestone 1 (spine)

Implements `JobStore`, `ActionLog`, `SettingsStore`.

- SQLite with a `schema_version` table and upgrade steps; jobs table; action log table.
- State machine: the allowed transitions between the statuses in `src/shared/job-status.ts`, enforced in `transition`; every transition is logged with its reason.
- Idempotent submit marker: `submitting` can only be left by `applied`, `unverified`, `needs-you` or `failed`; it is never retried blindly.
- Settings in a JSON file, defaults for missing fields, validation, refuse newer schema.
- Kill-switch helper `assertNotPaused(settings)`.
- **Verify:** illegal transitions throw `illegal-transition`; every transition appears in the log; reopening the database keeps data; a settings file with a missing field loads with the default.

### profile (`src/profile`) — milestone 1

Implements `ProfileStore`.

- Load, validate, save as readable JSON (two-space indent) with `version` bumped on each saved change.
- Helpers: `usablePoints`, `termsOf(profile)`, add/update/remove point, pending proposals area for model-written wordings (kept apart until approved).
- Project-note format and a loader (notes are Markdown files in the project notes folder); a function that checks a draft point only claims terms present in its note.
- Refuse a newer `schemaVersion`; never write held or excluded points as usable.
- **Verify:** save then load round-trips; version increments only when content changes; an invalid file gives a full-sentence error; a point with status `hold` or `excluded` is never returned by `usablePoints`.

### resume (`src/resume`) — milestone 2

Implements `ResumeBuilder`.

- Port the proven generator: selection per job (3–4 points per job, 3 per project, 3–4 projects, a fifth only if it fits), alternate wording by job keywords, Languages row first, matched items first, page-fit estimate against a limit calibrated on a real one-page resume, "not in your profile" report.
- The LaTeX preamble is the fixed template, copied unchanged; only the content between `\begin{document}` and `\end{document}` varies; the stretchable gaps are never edited.
- Escape `& % $ # _ { } ~ ^ \`; en and em dashes; links keep their real URL.
- A separate `compile` helper that runs `pdflatex` twice and reports the page count (used by a smoke script, not by unit tests).
- **Verify:** output is deterministic; the preamble equals the template byte for byte; no held, excluded or ask-first point appears; a keyword the profile does not hold never appears in the output; with no keywords the plain stored wording is used; escaping is correct for every special character.

### brain (`src/brain`) — milestone 1 basic, milestone 4

Implements `Brain`.

- A runner for `claude -p` and `codex exec` (command and arguments injectable), JSON-schema validation of the reply, one retry on invalid output, detection of a usage-limit message with its reset time.
- Budget (daily call cap), cache keyed by task, instructions, input hash and profile version, engine fallback, degraded mode.
- `FakeBrain` that replays recorded replies, a real selectable implementation used by tests.
- Claim check: extract claims from model-written text and block any that the point's terms or the profile do not support.
- Posting text always goes in `untrustedText`, never concatenated into instructions.
- **Verify:** a reply that does not match the schema is rejected after one retry; a limit message returns `limit-reached` with `resetAt`; the cache never calls the engine twice for the same input; the fallback engine is used when the main one reports a limit; text containing instructions cannot change the instructions sent.

### discovery (`src/discovery`) — milestone 3

Implements `Discovery`.

- Fetchers for Greenhouse, Lever and Ashby public job-board JSON; Workable, SmartRecruiters and Recruitee where a public feed exists; RSS feeds; board detection from a careers address.
- Normaliser to `Posting`; stable id from the canonical URL.
- Layered dedupe (identical link, same company+title+location, text similarity); repost handling; freshness (closed detection); ghost and scam flags.
- Fetch is injected (`fetchImpl`), so tests use saved responses in `fixtures/boards/`.
- **Verify:** the same job from five sources becomes one posting with five sources; a closed posting is flagged; a fixture with hostile text does not change behaviour; malformed JSON is rejected with a clear error.

### decide (`src/decide`) — milestone 3

Implements `Decider`.

- Hard rules: location and remote policy, salary floor, seniority, years of experience (full-time and internship months separately), excluded companies and industries, cooldown, blacklist; each dropped posting has recorded reasons.
- Keyword ranking against the profile's terms (0–100), no model.
- Shapes for batched scoring (eligibility, desirability, reasons, unmet requirements) as zod schemas used by brain callers.
- **Verify:** every hard rule has a test that drops and a test that keeps; a posting with no salary is not dropped by the salary rule; ranking is deterministic.

### web (`src/web`) — milestone 5 and the Profile view

- A local HTTP server on `127.0.0.1` only, using `node:http`, serving a small three-view page (Digest, Profile, Settings) and a JSON API for profile, settings and digest actions (approve, skip with tag, undo).
- The page is the approved design: minimal, neutral, light and dark, works at phone width, keyboard shortcuts on the Digest, editable Profile with the tailor preview, Settings that save at once.
- The server takes its dependencies (stores, resume builder) as arguments so tests use fakes.
- **Verify:** the server refuses non-local hosts; every API route validates input and returns a clear error; saving a point bumps the profile version; the page contains no real personal data; Digest keyboard actions call the API.

## Wave 2: wiring and the rest

- CLI subcommands calling each module; project reading with the brain; end-to-end test through the real entry point (profile, resume for a pasted job, discovery from fixtures, approve in the web API).
- Form adapters (apply): form snapshot, mapping, dry run, one board against saved HTML.
- Tracking: read-only mailbox, classification, matching, follow-up drafts, funnel.
- Platform alerts, assisted apply; health and backups.

## Phase acceptance

Wave 1 is done when every module's Verify holds and `npm run check` passes on `main`. The end-to-end scenarios (A, B, C, D, G, H in IDEA.md) are run in wave 2.
