# resume

The one-page resume builder: selection per job, keyword wording from approved alternates, the fixed LaTeX template, page-fit estimate, compile helper. Implements `ResumeBuilder`. It never calls a model: every word on the page is text the user stored or approved.

**Owner:** the `resume` agent, branch `feat/resume`. Only this folder (and its tests and fixtures) changes in its branch.

**Public interface:** `src/resume/index.ts`. Other modules import only from there or from `src/shared`.

**Plan and checks:** see the `resume` section of [docs/PLAN.md](../../docs/PLAN.md).

## Public interface

- `createResumeBuilder()` returns a `ResumeBuilder`; `build(profile, keywords, { company })` returns a `ResumeBuild` (LaTeX source, estimate, projects shown and left out, matched and unsupported keywords, file stem).
- `compileResume(texSource, outputDirectory, runner?, fileStem?)` writes the source, runs `pdflatex` twice and returns `{ pdfPath, pageCount }`. A missing `pdflatex` throws `ScoutError("unavailable")` with an install hint; a source that does not compile throws `ScoutError("invalid-input")` with the end of the log. The `runner` is injectable, so tests use a fake.
- `estimateLines(model)`, `LINE_LIMIT` (76.5) and `LATEX_PREAMBLE`.

```ts
import { createResumeBuilder, compileResume } from "../resume/index.js";

const build = createResumeBuilder().build(profile, ["TypeScript", "Kafka"], {
  company: "Example Corp",
});
// build.fileStem === "Alex_Rivera_ExampleCorp"; build.notInProfile lists unsupported keywords.
const { pdfPath, pageCount } = await compileResume(
  build.texSource,
  outputDirectory,
  undefined,
  build.fileStem,
);
```

## How a resume is built

1. Keywords are trimmed, lower-cased and de-duplicated.
2. Per job: up to four usable points. The first usable point (the headline) is always kept; the other places go to the points that support the most keywords. Stored order is kept.
3. Per project: three points chosen the same way. Projects are ranked by total match, most relevant first. The first three are always shown; a fourth and fifth only while the page-fit estimate stays within `LINE_LIMIT`.
4. Wording: the base text, or the alternate wording whose `keys` match the most job keywords.
5. Skills rows: matched items first inside a row, rows with more matches first, the "Languages" row always first.
6. The LaTeX is the fixed preamble plus the sections in fixed order. A section with nothing to show is left out because an empty list does not compile.

## Glossary

- **Usable point:** a point with status `confirmed` or `from code`. Held, excluded and ask-first points are never used.
- **Headline:** the first usable point of a job or project; always kept.
- **Alternate wording (variant):** an approved second wording of a point, chosen when the job mentions its `keys`.
- **Supported keyword:** a job keyword that is an `allowed` term of a usable point, a whole word in a usable point's chosen wording or in the summary, or an item in a skills row. Anything else is `notInProfile` and is never added.
- **Estimate / line limit:** a guess at how many lines the page needs, and the largest guess still treated as one page (76.5, calibrated on a real resume: 76.3 fits, 77.3 does not).
- **Preamble:** the fixed LaTeX template before `\begin{document}`; stored in `fixtures/resume/preamble.tex` and as `LATEX_PREAMBLE`, kept equal by a test.
- **File stem:** the file name without extension, e.g. `Alex_Rivera_ExampleCorp`.

## Tests and smoke script

- Unit tests: `npx vitest run src/resume` (or `npm test` for everything). They need no LaTeX.
- Smoke script (needs `pdflatex`; on a Mac add `/Library/TeX/texbin` to `PATH`):
  `PATH="/Library/TeX/texbin:$PATH" npx tsx src/resume/smoke.ts [outputDirectory]`.
  It builds resumes from `fixtures/profile.sample.json` and `fixtures/resume/large-profile.json` for several keyword sets, compiles each and prints the page counts; it exits with 1 if any is not one page.
