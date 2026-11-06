# discovery

Job board fetchers, normaliser, dedupe, freshness and ghost flags. Implements `Discovery`. Tests use saved board responses in `fixtures/boards/`.

**Owner:** the `discovery` agent, branch `feat/discovery`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/discovery/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `discovery` section of [docs/PLAN.md](../../docs/PLAN.md).

## What it does

1. **Fetch** one company's public board (`createDiscovery(...).fetchBoard`). Fetching is injected, bounded (timeout, response size cap) and polite (one request per host per second by default). Posting text is untrusted data and is never followed or obeyed.
2. **Parse** the board's format into `Posting[]`, one parser file per board in `boards/`: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, and RSS/Atom feeds.
3. **Normalise** each posting (`normalise.ts`): stable id, remote type, seniority, salary, skills, plain-text description, and warning flags.
4. **Dedupe** postings from many sources (`dedupePostings`).
5. **Freshness**: `closedSince` finds jobs that left their board; `markReposts` finds jobs that came back with a new date.

## Public interface, with an example

```ts
import {
  createDiscovery,
  dedupePostings,
  detectBoard,
  closedSince,
  describeFlag,
} from "../discovery/index.js";

const discovery = createDiscovery(); // real fetch; pass { fetchImpl } in tests
const board = detectBoard("https://boards.greenhouse.io/examplecorp/jobs/123");
// { kind: "greenhouse", token: "examplecorp" }

const now = new Date();
const postings = await discovery.fetchBoard(board!, now);
const unique = dedupePostings([...postings, ...otherBoardPostings]);
const closed = closedSince(yesterdaysPostings, postings); // each flagged "closed"
for (const flag of unique[0]!.flags) console.log(describeFlag(flag));
```

Exports: `createDiscovery`, `detectBoard`, `dedupePostings`, `closedSince`, `markReposts`, `describeFlag`, `ghostReasons`, `scamReasons`, `suspiciousTextReasons`, `canonicalizeUrl`, `postingIdFromUrl`, and the flag name constants.

Errors are `ScoutError`: `invalid-input` (malformed JSON/XML, oversize body, bad token), `not-found` (unknown board), `unavailable` (network, timeout, HTTP error).

## Flags

| Flag              | Meaning                                                                      |
| ----------------- | ---------------------------------------------------------------------------- |
| `ghost-suspect`   | Open more than 60 days, reposted 3 or more times, or very short or vague.    |
| `scam-suspect`    | Asks for fees, messaging-app contact, free-mail-only contact, wrong company. |
| `suspicious-text` | Text tries to give instructions to an AI reader. It was ignored.             |
| `repost`          | Same job under a new date. `reposts:N` counts how many times.                |
| `closed`          | The posting is no longer on its board.                                       |

## Glossary

Define each term of this module once here; code and comments use the short form.

- **Board**: a company's public job list on applicant-tracking software (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee) or an RSS/Atom feed.
- **Token**: the company's name on a board, such as `examplecorp` in `boards.greenhouse.io/examplecorp`. For a feed, the token is the feed address.
- **Official board**: one of the six applicant-tracking boards. Its version of a job wins over a feed copy.
- **Canonical address**: a job's address with tracking parameters (`utm_*`, `gh_src`, `lever-source`) and the fragment removed. The posting `id` is the first 16 hex characters of its SHA-256.
- **Source**: one place a job was seen (name and address). A merged posting lists all of them.
- **Dedupe layers**: identical canonical address; same company, title and location; similar title and similar description (Jaccard similarity of three-word shingles at or above 0.8).
- **Ghost job**: an opening that is probably not really being hired for.
- **Repost**: the same job reappearing with a new posted date.
- **Hostile text**: posting text that addresses an AI or tries to override instructions. Flagged as `suspicious-text`, never obeyed.

## How to run its tests

```
npm test -- src/discovery
```

The whole project check (typecheck, lint, all tests, format check) is `npm run check`. Tests use only the saved fictional responses in `fixtures/boards/`; no network.
