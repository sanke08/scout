# brain

The model bridge: Claude Code and Codex behind one `Brain` interface, schema-checked replies, budget, cache, fallback, degraded mode, claim check, and a `FakeBrain` for tests.

**Owner:** the `brain` agent, branch `feat/brain`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/brain/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `brain` section of [docs/PLAN.md](../../docs/PLAN.md).

## What it is

Scout asks a model for data (scores, proposed wordings) by running the `claude` command (always Sonnet 5.5, D-013) on the user's own subscription. This module builds the prompt, runs the command, finds the JSON in the reply, checks it against a zod schema, retries once if it is wrong, and returns either a value or a failure value. It never throws for model problems and the model never acts: it only returns data.

## Public interface

```ts
import {
  createBrainRouter,
  createCommandBrain,
  createDailyBudget,
  createFileCache,
  proposeWording,
} from "../brain/index.js";

const router = createBrainRouter({
  primary: createCommandBrain({ engine: "claude" }),
  budget: createDailyBudget({ limitPerDay: 40 }),
  cache: createFileCache(`${dataDirectory}/brain-cache`),
  profileVersion: profile.version,
});

const result = await router.run({
  task: "score-batch",
  instructions: "Score each job from 0 to 10 for fit.",
  untrustedText: postingText, // outside text goes here, never into `instructions`
  schema: scoreSchema,
});
if (!result.ok) {
  // result.reason is "limit-reached", "invalid-output" or "unavailable": degrade, do not crash.
}
```

| Export                                                                                        | What it is                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createCommandBrain({ engine, runner?, now?, configuration?, unknownResetCooldownMinutes? })` | Runs one engine as a command; remembers a reported limit until its reset time.                         |
| `createBrainRouter({ primary, fallback?, budget, cache, profileVersion, now? })`              | Cache, then budget, then primary, then fallback. Returns a failure value at once when none can answer. |
| `createFakeBrain(recordedReplies, name?)`                                                     | A real, selectable `Brain` that replays recorded replies; used by tests across the project.            |
| `createDailyBudget` / `createFileDailyBudget`                                                 | Calls allowed per UTC day, in memory or kept in a file between runs.                                   |
| `createMemoryCache` / `createFileCache`                                                       | Reply cache, in memory or one JSON file per key in a folder (atomic writes).                           |
| `buildPrompt`, `detectLimit`, `extractFirstJson`                                              | The prompt builder, the usage-limit detector and the JSON finder.                                      |
| `checkClaims`, `claimRetryInstructions`, `proposeWording`                                     | The claim check and the wording proposal built on it (scenario F).                                     |
| `createProcessRunner`, `ENGINE_CONFIGURATIONS`                                                | The real process runner (timeout, output cap) and the per-engine command and flags.                    |

Rules the module keeps:

- Outside text goes only in `untrustedText`. `buildPrompt` puts it in a block labelled untrusted data, after all of Scout's own text, with begin and end lines carrying a code taken from the text itself so the text cannot forge its own end line.
- A reply is accepted only if it matches the schema. One retry with a correction; then `invalid-output`.
- A missing program, a crash, a timeout or too much output gives `unavailable`. A usage-limit message gives `limit-reached` with `resetAt` when the reset time is known.
- The budget counts real engine calls per request. Cache hits cost nothing; a call that ended in a limit or "unavailable" is given back.
- The limit memory of a command brain and the in-memory budget and cache live for one process. Use the file-backed budget and cache for state that must last between runs.

## Command-line flags

All flags live in one object, `ENGINE_CONFIGURATIONS` in `engines.ts`, and were checked against the installed `claude` (D-013): `-p --model claude-sonnet-5-5 --tools "" --no-session-persistence`, the prompt on standard input. Codex and engine switching were removed. The wording of "usage limit" and reset-time messages (`limit-detection.ts`) is an assumption. If a flag is wrong, the tool exits with an error and Scout reports "unavailable"; pass `configuration` to `createCommandBrain` to change the command or flags without editing this module.

## Glossary

- **Brain:** the port in `src/shared/ports.ts`; `run(request)` returns a `BrainResult`.
- **Engine:** the one model program, `claude`, always run with `--model claude-sonnet-5-5`.
- **Failure value:** `{ ok: false, reason, message, resetAt? }`; how every model problem is reported.
- **Untrusted text:** text from outside Scout (a posting, an email). Data, never instructions.
- **Runner:** the function that starts an engine program; replaced by a fake in tests.
- **Limit / reset time:** the engine's reported usage limit and when it ends (`resetAt`, ISO).
- **Budget:** the number of real engine calls allowed per UTC day.
- **Degraded mode:** every engine is limited or unavailable; the failure value is returned at once and the model-free parts of Scout carry on.
- **Claim:** a skill, figure, team size, role word or year found in model-written text.
- **Claim check:** the model-free test that every claim is backed by the point's allowed terms or the profile's known facts.

## Run its tests

```
npx vitest run src/brain
```

or `npm run check` for everything. No test uses the network, a real model or the real `claude` program; the real process runner is tested against the Node program itself.
