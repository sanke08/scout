# Scout

A small, local job-hunting pipeline. It keeps **one editable profile** of everything true about you, finds jobs on official company job boards, filters and scores them, builds a **one-page resume per job** from your own points (reworded to the job's keywords, never adding a skill you do not hold), and prepares applications for you to approve.

Everything runs on your machine. The only AI is Claude Code or Codex, called from the command line on the subscription you already have. No other paid service, no API key.

> **Status: early build (version 0.1).** Every module exists and is tested with fakes. Nothing has been run against a real browser, mailbox or live application form yet: see [docs/PROGRESS.md](docs/PROGRESS.md) for exactly what works and what is unverified. Nothing here submits an application on its own: you approve every one.

## What it does

| Step     | What happens                                                                      | Needs the model?    |
| -------- | --------------------------------------------------------------------------------- | ------------------- |
| Profile  | One page where you read and edit every point, its status and the terms it may use | no                  |
| Resume   | One-page LaTeX resume per job, chosen and reworded from your points               | no                  |
| Discover | Poll official job boards, remove duplicates, flag closed and ghost postings       | no                  |
| Decide   | Hard rules, keyword ranking, then batched scoring of a shortlist                  | scoring only        |
| Digest   | Daily page of ranked cards; approve or skip with one key                          | no                  |
| Apply    | Fill forms on supported boards after your approval                                | no                  |
| Track    | Match replies to applications, draft follow-ups                                   | ambiguous mail only |

The full design is in [docs/IDEA.md](docs/IDEA.md).

## Quick start

You need **Node.js 24 or newer** and npm. For compiling resumes you also need a LaTeX installation with `pdflatex` (optional for everything else).

```bash
git clone https://github.com/sanke08/scout.git
cd scout
npm install
npm run check      # typecheck, lint, tests, format check
npm run dev -- version
```

### Your data stays out of the repository

Scout reads and writes your real data in a folder that git ignores:

```bash
export SCOUT_DATA_DIR="$HOME/.scout"   # default is ./data
```

Copy the fictional sample profile to start, then edit it by hand or in the Profile page:

```bash
mkdir -p "$SCOUT_DATA_DIR" && cp fixtures/profile.sample.json "$SCOUT_DATA_DIR/profile.json"
```

Never put real contact details in `fixtures/`: that folder is public.

## Commands

| Command                    | What it does                            |
| -------------------------- | --------------------------------------- |
| `npm run dev -- <command>` | Run Scout from source                   |
| `npm run build`            | Compile to `dist/`                      |
| `npm test`                 | Run all tests (no network, no accounts) |
| `npm run lint`             | Lint                                    |
| `npm run format`           | Format with Prettier                    |
| `npm run check`            | Everything CI runs                      |

## Tracking your applications

Every application, sent by Scout or by you, is kept in one ledger and written to `APPLICATIONS.md` in your data folder after every change.

```bash
npm run dev -- applications find okafor            # a recruiter called: find the application
npm run dev -- applications add --company Acme --title "Backend Engineer" --link https://example.com/jobs/12345 --recruiter "Sam Okafor" --phone "+1 555 0100"
npm run dev -- applications log <id> call "Phone screen Friday" --who Sam
npm run dev -- applications status <id> rejected "Email from Sam"
npm run dev -- applications contact <id> --next "Call back" --next-on 2026-11-14
npm run dev -- applications due                    # next steps that have come
```

The same actions are on the Applications tab of `scout serve`.

## Folder layout

```
src/
  shared/      contracts every module uses (types, ports, errors, paths)
  store/       SQLite storage, job state machine, action log, settings
  profile/     the editable profile and project notes
  resume/      one-page resume builder
  brain/       Claude Code / Codex bridge, budget, cache, claim check
  discovery/   job board fetchers, normaliser, dedupe, freshness
  decide/      hard rules and keyword ranking
  web/         local web page: Digest, Applications, Profile, Settings
  ledger/      every application: recruiter, job id, history, APPLICATIONS.md
  platforms/   sign-in per platform: by hand or saved in the OS keychain
  app/         composition root and command-line commands
  folders/     job folders, board table, leads, backups, health
  insight/     reading your projects once, interview plans
  tracking/    read-only mail, replies, follow-ups, alerts, funnel
  apply/       form snapshot, mapping, dry-run engine, evidence
fixtures/      fictional sample data used by tests (public)
docs/          design, plan, progress, decisions, review checklist
```

Each folder has its own `README.md` with a glossary and its public interface.

## Safety rules (always on)

- Scout never solves a CAPTCHA or bypasses a bot check. By default it never types a password: you sign in by hand once (`scout login <platform>`) and the session is reused. If you opt in per platform (`scout platforms set <platform> --login saved`), it can sign in once per run with credentials kept only in your OS keychain, and it stops at any CAPTCHA or code. See docs/DECISIONS.md D-012.
- Nothing is submitted, sent or posted without your yes for that action.
- Resume text comes only from points you wrote or approved; unsupported job keywords are listed, never added.
- Job postings are data, never instructions.
- The big job platforms are used for alert emails and assisted manual submit only.

## Contributing and workflow

This repository is built by several engineers (and agents) in parallel, each on a feature branch in its own git worktree, merged to `main` through a conflict check. Read [CLAUDE.md](CLAUDE.md) for the rules, [docs/DESIGN.md](docs/DESIGN.md) for the architecture and [docs/REVIEW.md](docs/REVIEW.md) for the review checklist.

## License

[MIT](LICENSE)
