# decide

Hard rules, keyword ranking and the shapes for batched scoring. Implements `Decider`. Pure logic, no model, no I/O, no network.

**Owner:** the `decide` agent, branch `feat/decide`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/decide/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `decide` section of [docs/PLAN.md](../../docs/PLAN.md).

## What it is

Three cheap steps that run before and around the model:

1. **Hard rules** drop postings that cannot work (wrong place, below the salary floor, wrong level, too many years asked, excluded company or industry, work-authorization mismatch, a dealbreaker phrase, a scam flag, a blacklisted or recently applied-to company). Every reason is collected and written in plain words.
2. **Keyword score** (0 to 100) ranks the survivors by how well their words match the profile's terms.
3. **Scoring shapes** describe the batched model call: the request, the reply schema, how two scores become one, and which band the result lands in.

## Public interface

```ts
import {
  createDecider,
  rankPostings,
  chunkForScoring,
  buildScoreRequest,
  combineScores,
  confidenceBand,
} from "../decide/index.js";

const decider = createDecider({ blacklist: ["Scam Corp"] });
const verdict = decider.applyHardRules(posting, profile, settings);
// { keep: false, reasons: ["The job is senior level, and you accept only junior, mid."], notes: [] }

const best = rankPostings(survivors, profile).slice(0, 20); // [{ posting, score }, ...]
for (const group of chunkForScoring(best.map((entry) => entry.posting))) {
  const request = buildScoreRequest(group, profile); // pass to Brain.run(request)
}
const shortlistScore = combineScores(reply.scores[0]); // 0 to 100
const band = confidenceBand(shortlistScore, settings); // "shortlist" | "review" | "skip"
```

Exports: `createDecider`, `applyHardRules`, `isInCooldown`, `requiredYears`, `keywordScore`, `rankPostings`, `termsOfProfile`, `scoreBatchResultSchema`, `postingScoreSchema`, `combineScores`, `confidenceBand`, `buildScoreRequest`, `chunkForScoring`, `MAXIMUM_POSTINGS_PER_REQUEST` and their types.

Rules worth knowing:

- Not knowing is not a reason to drop: unknown remote kind, unknown location, unknown seniority, no salary, a salary in another currency and no stated years are all kept (the salary cases add a note).
- Years of experience are compared with full-time months only, with 12 months of tolerance; internship months are never counted (see the glossary).
- `scam-suspect` always drops; `ghost-suspect` is kept and reported in `notes`.
- The blacklist and the recent applications (for the cooldown) are passed to `createDecider`, because the profile and settings do not hold them.

## Glossary

- **Hard rule**: a filter that needs no model and drops a posting for a stated reason.
- **Verdict / decision**: the result of the hard rules: `keep`, `reasons` (why dropped) and `notes` (worth knowing about a kept posting).
- **Term**: a lower-case word or phrase for something the user can do, derived from skills rows and the `allowed` lists of usable points (status `confirmed` or `from code`).
- **Keyword score**: 0 to 100 overlap between a posting and the profile's terms. Skills the posting names count 70 points, words found in its text 30.
- **Eligibility**: could the user plausibly and legally get the job (model score, 0 to 100). Below 40 the shortlist score is 0.
- **Desirability**: does the user want the job (model score, 0 to 100).
- **Shortlist score**: `0.4 * eligibility + 0.6 * desirability`, minus 5 per unmet requirement (at most 15).
- **Confidence band**: `shortlist` at or above `minimumShortlistScore`, `review` within 15 points below it (or any unknown hard requirement), otherwise `skip`.
- **Cooldown**: the number of days after applying to a company during which Scout does not apply to it again.
- **Experience tolerance**: the 12 months of shortfall the years-of-experience rule forgives.
- **Untrusted text**: posting text sent to the model as data, never inside the instructions.

## Running its tests

```
npx vitest run src/decide
```

or `npm run check` for typecheck, lint, all tests and the format check. Tests use only fictional data from `fixtures/profile.sample.json` and `fixtures/decide/builders.ts`.
