# insight

Reading the user's own projects once, and preparing for interviews. It turns a project folder into a verified note, notes into draft profile points, and a job plus the resume that was sent into an interview plan.

**Owner:** the `insight` agent, branch `feat/insight`. Only this folder (and `fixtures/insight/`) changes in its branch.

**Public interface:** `src/insight/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the Wave 2 section of [docs/PLAN.md](../../docs/PLAN.md) and idea document sections 5.2 (understanding the user's projects once) and 5.13 (interview preparation), scenario A.

## What it is

Two jobs that both read untrusted text and must not make anything up.

1. **Project reading (scenario A).** `readRepository` lists and reads a project folder safely and returns a small, bounded digest. `writeProjectNote` asks the brain to describe the project as structured data, then plain code checks the reply against the digest and writes one Markdown note. `draftProfileFromNotes` turns notes into `hold` draft points for the user to review. `authoredByUser` keeps only the commits the user wrote.
2. **Interview preparation.** `buildInterviewPlan` builds a plan from plain rules (requirements by weight, stories from the resume as sent, honest answers for gaps, likely rounds, questions to ask). A brain may add practice questions; without one, or if it fails, the rules-only plan is returned.

Nothing here runs the project's code, installs anything, writes inside a repository, saves into the profile, or sends anything. The model only returns data.

## Public interface

```ts
import { createFakeBrain } from "../brain/index.js";
import {
  authoredByUser,
  buildInterviewPlan,
  draftProfileFromNotes,
  readRepository,
  writeProjectNote,
} from "../insight/index.js";
import { loadProjectNotes } from "../profile/index.js";
import { projectNotesDirectory } from "../shared/index.js";

const digest = readRepository("/work/pocket-queue", { maxSourceBytes: 40_000 });
const written = await writeProjectNote(brain, digest, {
  notesDirectory: projectNotesDirectory(),
});
if (!written.ok) {
  // written.reason is "limit-reached", "invalid-output" or "unavailable"; nothing was written.
} else {
  // written.droppedStackTerms: terms the code does not show, removed from the note.
}
// A second call for the same project throws ScoutError("invalid-input") unless { force: true }.

const drafts = draftProfileFromNotes(loadProjectNotes(projectNotesDirectory()));
// Every drafted point has status "hold"; show them to the user, never save them directly.

const mine = authoredByUser(gitLogLines, [{ name: "Alex Rivera", email: "alex@example.com" }]);

const { plan, markdown } = await buildInterviewPlan({
  job: { company: "Example Hotels", title: "Backend Engineer" },
  jobDescription, // the saved description, word for word
  resumeSent, // the resume points exactly as sent
  profile,
  brain, // optional
});
```

| Export                                     | What it does                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `readRepository(directory, limits?)`       | Bounded `RepositoryDigest`: tree, README, configuration files, the most informative source files, what was skipped.    |
| `writeProjectNote(brain, digest, options)` | Asks the brain for a note, verifies it, renders it in the profile note format, writes it once. Returns a result value. |
| `verifyNote(reply, evidenceText)`          | The model-free check and the do-not-claim builder behind the writer.                                                   |
| `draftProfileFromNotes(notes)`             | One `DraftProject` per note; points built by the profile module's `draftPointsFromNote`, all `hold`.                   |
| `authoredByUser(lines, identities)`        | Commits whose author is one of the user's identities. Pure.                                                            |
| `buildInterviewPlan(input)`                | `{ plan, markdown }`: the typed `InterviewPlan` and its Markdown text.                                                 |
| `renderInterviewPlan(plan)`                | The Markdown view of a plan.                                                                                           |

## How the reader stays safe

- Symbolic links are never followed, so nothing outside the folder is read. Pipes, sockets and devices are never opened. Files are opened without following a link.
- Ignored: `node_modules`, `.git`, build output, caches, lockfiles, binary files (by extension and by a zero byte), files over `maxFileBytes`, and secret-looking files (`.env`, keys, `credentials.json`).
- Limits (all reported in `limitsHit` or `skipped`, never silent): entries seen, depth, file size, tree size, README bytes, configuration bytes, source bytes. Defaults are in `DEFAULT_REPOSITORY_LIMITS`.
- It reads files only. The digest holds the folder's name, never its full path.

## How a note is made

1. If a note for this folder already exists and `force` is not set, stop with `invalid-input` before any model call is spent ("read once, not again unless asked").
2. The brain gets Scout's instructions, with the whole digest in `untrustedText`. Text inside the repository cannot reach the instructions.
3. The reply must match the note schema: title, overview, verdict (`real project`, `tutorial copy`, `demo`, `unfinished`) with a reason, stack, features (name, how it works, status `built`, `half-built` or `described-only`, design decisions, failure handling), figures, do-not-claim. The brain retries once; a reply that is still invalid is returned as a failure and nothing is written.
4. Plain code then drops every stack term and every figure that does not appear in the digest's **configuration or source files** (the README is not evidence: the note exists to check it). The verdict is never changed by code or by repository text: it is whatever the brain returned.
5. The "Do not claim" list always exists. It always holds two standing warnings (not production ready; nothing the README says that the code does not show), a warning for any verdict other than `real project`, one line per feature that is not fully built, one line per dropped term or figure, and then the model's own list.
6. Every value is cleaned to one line before it is rendered, so text in a reply cannot add a heading or bullet to the note. The file is `<folder-name>.md`, written exclusively (`wx`) unless `force` is set.

The note file follows the format in [src/profile/README.md](../profile/README.md). Each feature is one bullet with indented lines for design decisions and failure handling. Two extra sections, "Numbers" and "Read once", are ignored by the profile parser and are there for people.

## How the interview plan works

- **Requirements** come from a fixed list of well-known technologies, the posting's own skills list and the profile's terms. Weight is one point per mention, three more for a mention that asks firmly ("required", "must", "strong", or under a "Requirements" heading), half a point for a mention in a "nice to have" sentence, two more for a term in the title and two for a term the posting lists. Terms of one or two letters (such as "Go") are taken only from the posting's skills list.
- **Coverage** of each requirement: `on-resume` (a point as sent shows it, in its words or in the allowed terms of the profile point it came from), `profile-only` (the profile has it, the resume sent does not), or `gap`.
- **Stories** are the resume points sent that show a requirement, in the sent words. The problem and the decision are asked of the user ("answer from your own memory"); the plan never invents them.
- **Gaps** get "I have not used X in production. I have used Y, which does a similar job, ..." where Y is a term the user may use (skill rows and confirmed or from-code points) in the same family as X. With no such term the answer says plainly that X was not used.
- **Rounds:** recruiter screen, technical screen, project deep dive, system design (only when the job text suggests it), behavioural. Plus questions the user can ask.
- **Model:** with a brain, up to ten extra practice questions (job text as `untrustedText`). With no brain or a failed one: `modelUsed` is false and `degradedReason` says why.

## Known limits

- A stack term is checked by exact name (ignoring capitalisation), so "Node.js" is found only if the configuration or code writes it that way. This is deliberately strict: a wrongly dropped term costs one line of editing, a wrongly kept one is a false claim. Dropped terms are listed in the result and in the note.
- The reader returns the start of each file, not a summary of a huge one; truncation is marked on the file.
- The known-technology list is short and English only; terms outside it are found only through the posting's skills list or the profile.
- `authoredByUser` reads the author field only. Commits where the user is a co-author in the message are not counted.
- The note names the project from the folder name, so two folders with the same name share one note file.

## Glossary

- **Digest:** the bounded, plain-data view of a repository that the note writer works from.
- **Verified note:** a Markdown file describing one project once, in the profile note format, with unverifiable terms and figures removed.
- **Evidence text:** the configuration and source text of a digest; claims are checked against it.
- **Do-not-claim list:** statements the user must not make about a project; always present.
- **Draft point:** a `hold` point built from a note's feature, for the user to review.
- **Requirement:** a technology the job text asks for, with a weight and how well the user covers it.
- **Coverage:** `on-resume`, `profile-only` or `gap`.
- **Story:** a resume point as sent, to be told with its problem and decision.
- **Gap:** a requirement the profile does not hold, with an honest way to answer.
- **Degraded plan:** the rules-only plan returned when no model is supplied or the model fails.

## Run the tests

```
npx vitest run src/insight
```

or `npm run check` for all gates. Tests use `fixtures/insight/` (a fictional "Pocket Queue" repository, a recorded model reply and the expected note), temporary folders and a fake brain; they need no network or real model.
