# profile

The editable profile: load, validate, save with versions, points and their statuses, pending model proposals, project notes. Implements `ProfileStore`.

**Owner:** the `profile` agent, branch `feat/profile`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/profile/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `profile` section of [docs/PLAN.md](../../docs/PLAN.md).

## What it is

The one place that reads and writes `profile.json`, the user's single source of truth. The file is plain JSON with a two-space indent so it can be edited by hand. This module never invents or rewords anything: it validates, versions, and offers small pure helpers that return a new profile each time.

## Public interface

```ts
import {
  addVariant,
  createProfileStore,
  createProposalStore,
  missingRequiredFields,
  usablePoints,
} from "../profile/index.js";
import { profilePath } from "../shared/index.js";

const store = createProfileStore(profilePath());
if (!store.exists()) {
  // run first-run setup, then save the answers
}
const profile = store.load(); // throws ScoutError("not-found" | "invalid-input")
const first = profile.experience[0]!.points;
const usable = usablePoints(first); // never hold, excluded or ask first
const changed = addVariant(
  profile,
  { section: "experience", entryIndex: 0, pointIndex: 0 },
  variant,
);
const saved = store.save(changed); // version + 1 only because the content changed

const proposals = createProposalStore(proposalsPath);
proposals.approve(id, store); // adds the variant, bumps the version once, removes the proposal

missingRequiredFields(saved); // [] means the pipeline may run
```

| Function                                                          | What it does                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createProfileStore(path)`                                        | `exists`, `load`, `save`; atomic writes; refuses invalid files and a newer `schemaVersion`, untouched. |
| `usablePoints(points)`                                            | Only `confirmed` and `from code` points.                                                               |
| `termsOfProfile(profile)`                                         | Every skill item and every point's `allowed` term, lower-cased, no duplicates.                         |
| `addPoint`, `updatePoint`, `removePoint`, `setPointStatus`        | Edit one point, addressed by section, entry index and point index.                                     |
| `addVariant`, `removeVariant`                                     | Edit alternate wordings; a variant's keys must all be in the point's `allowed` list.                   |
| `variantUsesOnlyAllowedTerms(point, variant)`                     | The check behind the line above.                                                                       |
| `createProposalStore(path)`                                       | `add`, `list`, `approve(id, profileStore)`, `reject(id)` for model-written wordings awaiting approval. |
| `loadProjectNotes(directory)`, `parseProjectNote(fileName, text)` | Read verified project notes (format below).                                                            |
| `draftPointsFromNote(note)`                                       | `hold` draft points; `allowed` only from the note's stack terms that the feature text mentions.        |
| `missingRequiredFields(profile)`                                  | The first-run fields still empty, each with the question to ask.                                       |

Errors are always `ScoutError` with a full sentence: `not-found` (no profile file), `invalid-input` (bad content, naming the field path; a newer `schemaVersion`; a variant using a term outside `allowed`; a position that does not exist), `unavailable` (the disk cannot be read or written).

## Versions

`save` compares the new content with the file on disk, ignoring only `version`. Changed content: the saved `version` is the file's version plus one. Identical content: nothing is written and the file's version is returned. The first save, when no file exists yet, counts as a change (version plus one). A file on disk that is invalid or from a newer Scout makes `save` fail without overwriting it.

## Pending proposals

A proposal (a model-written wording for one point) is stored in its own file, never inside the profile, with an id, the target point, the proposed text, its keys, a creation time and the claim-check result as text. Nothing changes in the profile until `approve`.

## The verified project note format

One Markdown file per project in the project notes folder (`projectNotesDirectory()` in `src/shared`). The first line `# Title` is required; the five fixed `##` sections are all optional, matched ignoring capitalisation; other sections are ignored.

```
# Message Queue

## Overview
One paragraph: what the project is.

## Verdict
Is it real, tutorial-derived, a demo or unfinished?

## Stack
- Go
- PostgreSQL, Redis

## Features
- One bullet per feature, in plain words. A line indented under a bullet continues it.

## Do not claim
- One bullet per statement that must not be made.
```

Stack terms may be bullets, comma-separated lines, or both. A note with no title is rejected with the file name; a missing section simply gives an empty value.

## Glossary

- **Point:** one experience or project statement, stored once, with a status, allowed terms and alternate wordings.
- **Status:** `confirmed`, `from code`, `ask first`, `hold` or `excluded`; only the first two are usable without asking.
- **Allowed terms:** the technologies the user confirms are true for one point.
- **Variant (alternate wording):** another wording of the same fact, with the job terms (keys) that trigger it; its keys must be allowed terms.
- **Address:** the position of a point: section (`experience` or `projects`), entry index, point index.
- **Proposal:** a model-written wording waiting for the user's approval, kept outside the profile.
- **Verified note:** a Markdown file describing one project once, in the format above.
- **Draft point:** a `hold` point built from a note's feature, with terms taken only from the note's stack.
- **Version:** a counter in the profile that goes up by one on every saved change.

## Run the tests

```
npx vitest run src/profile
```

or `npm run check` for all gates. Tests use temporary folders and `fixtures/profile.sample.json` (a fictional person); they need no network.
