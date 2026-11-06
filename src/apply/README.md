# apply

The safe core of applying to jobs on official boards: read the form, map every field, plan the fill, fill and verify, and (only when every rule allows) submit once and check the result. Nothing in this module submits anything on its own.

**Owner:** the `apply` agent, branch `feat/apply`. Only this folder and `fixtures/forms/` change in its branch.

**Public interface:** `src/apply/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and rules:** the `apply` slice of [docs/PLAN.md](../../docs/PLAN.md); the behaviour is section 5.10 (applying) and 5.11 (evidence) of [docs/IDEA.md](../../docs/IDEA.md), scenarios I, J, O and P.

## Honest status

- Everything that decides behaviour is tested with a **fake driver** working on saved HTML in `fixtures/forms/`.
- The saved forms are **fictional** pages written in the style of Greenhouse, Lever and Ashby. They are not copies of a real company's page, and a real board may differ. Nothing has been checked against a live form.
- `createPlaywrightDriver` (the real browser) is **not tested against a real browser**. It needs a manual try on a test form before it is trusted.
- A user who sets a board to "Fill I submit" presses submit in the visible browser themselves. This module submits only at level Automatic (see below).

## Public interface

| Export                                                         | What it does                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshotForm(html)`                                           | Reads a saved form page into a `FormSnapshot`: fields (label, name, type, required, options, selector), the submit control and a shape hash. |
| `classifyQuestion(label)`                                      | Sorts a question into factual, personal, motivational, legal, demographic or salary with plain keyword rules.                                |
| `mapFields(snapshot, profile, answerBank, settings)`           | Maps each field to a profile value, an approved answer, the resume, or a status of `needs-you`, `draft-needed` or `unknown`. Never guesses.  |
| `planApplication({ url, snapshot, mappings, ... })`            | Returns the ordered fill actions and the blockers (required fields that are not ready). A plan with any blocker is never carried out.        |
| `runApplication(arguments)`                                    | The one place that may press submit. Applies the kill switch, levels, dry run, daily limit, two-pass fill, submit marker and verification.   |
| `mayAutoSubmit(conditions)`                                    | The single rule that allows a submit: live run, board level `auto`, apply mode `auto`, job `approved`.                                       |
| `runSelfTest(driver, fixture)`                                 | A dry run on a stable page. Returns `passed` and reasons, so a caller can pause automatic submission for a board.                            |
| `saveEvidence(directory, evidence)`                            | Writes the form snapshot, filled values, screenshots, confirmation text, timestamps and profile version into a folder.                       |
| `detectPageBlocker(text, html)`, `looksLikeConfirmation(text)` | Finds a CAPTCHA, sign-in wall, one-time code, assessment or closed job; recognises a real confirmation message.                              |
| `fillAndVerify(driver, plan)`                                  | The two-pass fill on its own (never submits).                                                                                                |
| `BrowserDriver`                                                | The small interface a real browser or a fake implements.                                                                                     |
| `createPlaywrightDriver({ profileDirectory })`                 | Starts the real browser (persistent profile in your own folder, visible by default). Loaded on demand; untested against a real browser.      |

```ts
import {
  createPlaywrightDriver,
  mapFields,
  planApplication,
  runApplication,
  snapshotForm,
} from "../apply/index.js";

const html = await readFormPage(url); // the caller fetches the page; this module only parses it
const snapshot = snapshotForm(html);
const mappings = mapFields(snapshot, profile, profile.answerBank, settings);
const plan = planApplication({ url, snapshot, mappings, resumeFilePath });

const driver = await createPlaywrightDriver({ profileDirectory });
const result = await runApplication({
  driver,
  plan,
  level: settings.boardLevels["greenhouse"] ?? "prepare",
  mode: "live",
  settings,
  jobs,
  jobId,
  appliedToday: () => countAppliedToday(),
  boardHasCleanRun: false,
  now: () => new Date(),
  profileVersion: profile.version,
  evidenceDirectory,
});
// result.outcome is one of: staged, blocked, needs-you, closed, dry-run-complete,
// filled-for-review, applied, unverified. result.reason is a sentence for the user.
```

## The apply flow

`runApplication` does these in order and stops at the first one that says stop:

1. **Kill switch.** `assertNotPaused(settings)` throws `paused` before anything else.
2. **Job check.** The job must be `resume-ready` or `approved`. A job already in `submitting` is refused with `unsafe`: an interrupted submit is never retried blindly (Scenario O).
3. **Blockers.** A plan with blockers (a required field that is unknown, a legal, personal, salary or demographic question with no approved answer, a required motivational question with no approved draft, a missing resume, no submit button) moves the job to `needs-you`. No browser opens.
4. **Level.** `prepare` ends here as `staged`. Nothing is opened.
5. **Daily limit.** If a submit could happen, `appliedToday()` must be below `dailyApplicationLimit`, else `limit-reached` is thrown before any browser opens.
6. **Open and check.** A CAPTCHA, sign-in wall, password field, one-time code or assessment moves the job to `needs-you`; a closed job moves it to `closed`. If the live form's shape hash differs from the plan's snapshot, nothing is filled (Scenario P).
7. **Two-pass fill.** Fill every action, then read every field back. Any difference stops with `needs-you`.
8. **Screenshot and evidence.** The screenshot is taken and evidence is saved. If saving fails, nothing is submitted.
9. **Stop unless allowed.** Without permission the run ends as `dry-run-complete` or `filled-for-review`.
10. **Submit once.** The job moves to `submitting` through the job store, and only then is the submit control pressed, once.
11. **Verify.** A real confirmation message gives `applied`. Anything else, or any error, gives `unverified`. There is no retry.

A submit is allowed only when all of these hold (`mayAutoSubmit`): the run is live (not a dry run), the board level is `auto`, `settings.applyMode` is `auto`, and the job is `approved`. A run is a dry run when `mode` is `"dry-run"` or when `settings.dryRunFirst` is on and the board has no clean-run record. In every other case the run fills, checks and stops, so Automatic behaves as Fill I submit.

## Field mapping rules

Per field, in order: file inputs (resume, cover letter), then profile identity (name, email, phone, links, location), then an approved answer-bank entry (the entry needs an approval date), then the never-guess rules:

| Kind                    | Not in the bank                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| factual                 | `unknown`                                                                                                                          |
| motivational            | `draft-needed` (a caller may ask the model for a draft; the user approves it into the bank)                                        |
| legal, personal, salary | `needs-you`                                                                                                                        |
| demographic             | `settings.demographicAnswers`: `prefer-not-to-say` picks the option that says so when there is one; `ask-each-time` is `needs-you` |

An approved answer that is not one of a drop-down's or radio group's choices is `needs-you`. A required field that is not `ready` is a blocker; an optional one is left blank.

## Files

| File                                           | Purpose                                                       |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `form-types.ts`, `snapshot.ts`                 | The form as data and the HTML reader.                         |
| `classify-question.ts`, `map-fields.ts`        | Question kinds and field mapping.                             |
| `plan.ts`                                      | `FillPlan` and blockers.                                      |
| `driver.ts`, `fake-driver.ts`                  | The browser interface and the test fake.                      |
| `page-checks.ts`                               | CAPTCHA, sign-in, code, closed and confirmation detection.    |
| `fill-engine.ts`                               | The two-pass fill.                                            |
| `run-application.ts`                           | The run, levels, dry run, limit, submit marker, verification. |
| `evidence.ts`                                  | Evidence files.                                               |
| `self-test.ts`                                 | Board self-test.                                              |
| `playwright-driver.ts`, `playwright-loader.ts` | The real browser driver and its lazy loader.                  |
| `fixtures/forms/`                              | Fictional saved forms and their expected snapshots.           |

## Glossary

- **Form snapshot:** the whole form saved as structured data before any fill.
- **Shape hash:** a short fingerprint of the form's fields and submit button; it changes when the form changes.
- **Blocker:** a reason a plan cannot be carried out until a person helps.
- **Two-pass fill:** write all values, then read them all back and compare.
- **Dry run:** everything except the final submit.
- **Submit marker:** the `submitting` status, set through the job store just before the click so an interrupted submit is never repeated.
- **Unverified:** a submit whose result could not be proven by a confirmation message.
- **Clean run:** a run that filled and read back every field with no mismatch; a board with one may leave dry-run-first.
