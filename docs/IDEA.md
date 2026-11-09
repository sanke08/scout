# Scout

**A small autonomous job-hunting pipeline that runs on the user's own machine: it keeps one editable profile of everything true about the user, finds jobs from official company job boards and other sources, filters and scores them, builds a one-page resume for each job from the profile by choosing and rewording real points to match the job's keywords, applies on the forms it can handle reliably after the user's approval, stages the rest for a one-minute manual submit, and tracks every reply, using only Claude Code or Codex as its brain and no other paid service.**

This document describes what Scout is, why it exists, how it behaves, and what it deliberately leaves out. It contains no code and no implementation details. It is the input for planning the build. It is self-contained: nothing here requires reading any other document.

---

## 1. What Scout is, in one paragraph

Scout is the part of a job-search service (LazyApply, Sonara, Simplify, Teal, an applicant-tracking system seen from the applicant's side) that is not the marketing: the pipeline underneath. A job hunt is a loop of seven jobs. Know the candidate, find postings, throw away the ones that are duplicates, closed or impossible, rank the rest, prepare an honest resume and application for the good ones, submit, and notice what comes back. Paid services bundle all of it, run it on someone else's servers, and charge monthly. Scout keeps it on the user's laptop. At its centre is one **profile**: every experience point, project point, skill, contact detail and approved answer, each stored once, each with a status that says how sure it is, each with the exact terms it may truthfully use and any alternate wordings the user has approved. The user can open the profile as a page and edit any of it by hand. For every job, Scout builds a one-page resume from that profile on a fixed, proven layout: it picks the strongest points for the job, swaps in the alternate wording that matches the job's keywords, and never adds a skill the profile does not hold. Scout polls the official job boards of a growing list of target companies and a few free feeds, stores everything in one local database with a state for every job, and uses cheap rules for most of the filtering. The model (Claude Code or Codex, called from the command line on the subscription the user already has) is used only where language matters: reading projects once, scoring a shortlist in batches, proposing new wordings for the user to approve, drafting answers that are not in the answer bank, classifying ambiguous mail, proposing repairs to a broken form adapter, and preparing interview plans. Nothing is submitted that the user has not approved, until a given site and question pattern has proved itself many times in dry runs. Every application leaves evidence: the exact files sent, a screenshot of the filled form, and the confirmation. A local page with three views (Digest, Profile, Settings) is the whole interface. It is the job a paid auto-apply service does, reduced to its essentials, with the cloud replaced by a laptop and the paid model replaced by a tool the user already has, and written end to end by one person.

---

## 2. Why we are building it

### 2.1 The money goal

Job-search automation services charge a monthly fee, and the cheap ones apply blindly to hundreds of jobs, which hurts the user's reputation and often breaks their accounts on the big job platforms. The data they need (job postings from official boards) is public and free. The model work they need is small if the funnel is built well. Scout does the whole job with no new spend: free sources, free open tools, and the Claude Code or Codex subscription the user already pays for. The honest limit is that the subscription has usage limits, so the design treats model calls as a scarce budget and never as free.

### 2.2 The learning goal

Building Scout forces the answers:

- How to build a pipeline that never loses its place: a state for every job, every step recorded, every step safe to repeat.
- How to keep one source of truth and generate every output from it, so a resume, an application answer and an email can never disagree.
- How to let a language model help without letting it invent: it proposes, the user approves, and generated text is checked against stored facts.
- How to adapt wording to a job's keywords honestly: only terms the user has marked true, only wordings the user has approved.
- How to generate a document from a fixed template so that the layout is always right and only the content varies, and how to prove it is one page.
- How to ingest many messy sources into one clean record, and how to tell the same job apart across five sites.
- How to spend a scarce model budget: cheap filters first, one batched call for many items, caching by content, a daily cap, and a mode that still works when the model is unavailable.
- How to automate a web form reliably: read the form before filling, fill, read it back, submit, and prove success with evidence.
- How to automate without crossing lines: no password handling by the model, no beating bot checks, a human approval gate that is earned away, not assumed away.
- How to measure a system that has no single right answer: a hand-labelled set of jobs, scorer precision and recall, fill accuracy, and reply rates by source.
- How to resist untrusted text: a job posting is written by a stranger and may try to give the model instructions.

### 2.3 The interview goal

After this project, the following questions have first-hand answers:

- "Design a job-aggregation and application pipeline." (sources, ingestion, dedupe, freshness, scoring, state machine, human in the loop)
- "How do you make a crawler polite, resumable and idempotent?"
- "How do you deduplicate records that describe the same thing from different sources?"
- "How do you use an LLM safely inside an automated workflow, and how do you evaluate it?"
- "What is prompt injection and how do you defend a pipeline against it?"
- "How do you prevent a duplicate side effect (a double submission) after a crash?"
- "How do you design for a rate-limited, metered dependency?"
- "How would you generate a document from structured data so the output is always valid?"
- "How do you keep a single source of truth editable by a human and safe for automation to read?"

### 2.4 The real use case (the north star)

The north star is **the author's own job search, run by an agent at no extra spend, with the author spending about ten minutes a day.** Once, the author reads each of their projects with the agent and approves the resulting profile: every point written once, with its terms and its status. After that, each morning the author opens one local page. The Digest shows a short ranked list: ten to twenty jobs posted in the last day or two, each with a fit score, the reasons, what is missing, a tailored one-page resume ready to view, and the answers the form will get. The author approves most, skips a few with a one-word reason, and corrects one answer. For jobs on the official boards Scout submits and records the confirmation. For jobs that can only be applied for inside a big platform, Scout opens the page in the author's own signed-in browser with everything prepared, and the author presses submit. When a good job asks for something the profile words differently, the author opens the Profile view, adds one alternate wording, and every later resume can use it. Over the following days replies are matched to applications, silent applications get a drafted follow-up, and a weekly view shows what is working.

The demo at the end: on one laptop with nothing but Claude Code or Codex installed, the author builds a profile once, points Scout at thirty companies, and lets it run for a week. The presenter shows the Profile view and edits a point by hand; pastes a job's keywords and watches the resume change its wording and drop a project to stay on one page; shows the daily digests; shows one application submitted end to end with its evidence; shows one question that stopped the pipeline because it was not in the answer bank; shows a morning where the model's usage limit was hit and the pipeline carried on in degraded mode; shows one reply matched to its application; and shows the funnel numbers.

That gives Scout exactly one kind of workload: **one person's job search, continuously, from public sources, on a laptop, with a scarce model budget and a human who approves.**

Every feature below should be judged by: _does it help the right job reach the user quickly, with an application that is honest, correct and proven sent, while spending as little of the model budget and the user's attention as possible?_

---

## 3. Why it is not a LazyApply, Sonara, Simplify or resume-builder clone

Scout uses the ideas behind those services because the ideas are correct, and their words (job, application, resume, profile) because new ones would only confuse. Beyond that it is a different thing.

| LazyApply / Sonara / Simplify / Teal / resume builders                                                | Scout                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted services; the user's profile, resume, passwords and sessions live on someone else's servers.   | Everything is on the user's machine. The only things that leave it are page requests and the application itself.                                            |
| Optimised for volume: apply to hundreds of jobs.                                                      | Optimised for fit and truth: a few well-matched, honestly tailored applications a day.                                                                      |
| Mostly built around the big job platforms, which forbid automation and ban accounts.                  | Built around official company job boards first; the big platforms are used for discovery by email alert and for assisted manual submit.                     |
| The model writes whatever sounds good, including claims the user cannot back up, and stuffs keywords. | Resume text comes from points the user wrote or approved; wording changes only to terms the user marked true; a separate check blocks anything unsupported. |
| The profile is a form buried in settings, or a pile of resume files.                                  | One profile page the user can read and edit by hand, where every point carries its status and the terms it may use.                                         |
| Opaque: you cannot see why a job was chosen or what was sent.                                         | Every decision has reasons, and every application has its evidence on disk.                                                                                 |
| A paid model behind a monthly price.                                                                  | Claude Code or Codex on the user's own subscription, with usage budgeted and a mode that works without it.                                                  |
| Success is "applications sent".                                                                       | Success is "replies and interviews per application", measured, and fed back into scoring.                                                                   |

Applicant-tracking systems such as Greenhouse and Lever are built for employers; Scout is built for the applicant and reads the same public job boards they publish. Browser autofill extensions fill a form the user opened; Scout finds the job, decides whether it is worth it, builds the resume, and prepares the form. Scout is "the useful core of an auto-apply service, small enough to read in a weekend, run entirely at home".

---

## 4. Scenarios

These are the stories Scout must support. Each is a working demo at some milestone, and each is also a recorded run against saved pages and a fake model so it can be checked with no network and no account.

**Scenario A: first run, building the profile from the user's own projects.**
The author installs Scout and starts it for the first time. It asks them to point at their resume and their code repositories. Scout reads each repository once, end to end, and writes a verified note per project: what it is, what is really built, what is half-built, what must not be claimed. It then interviews them about work history, target roles, locations, salary floor, notice period, work authorization, dealbreakers and companies to exclude. From the notes and answers it drafts the profile: every experience point and project point with its status and the terms it may truthfully use. The author reads the profile page, edits what is wrong, and approves it. Nothing in the pipeline can run until the profile exists. Scout does not read the repositories again unless asked. Milestone 1.

**Scenario B: editing the profile by hand.**
The author opens the Profile view. They reword a bullet, add the word "Kafka" to the terms a point may use, mark a doubtful point as "hold" so it never reaches a resume, add a new project with three points, and add an alternate wording for one bullet that is used only when a job mentions "dead-letter queue". Each edit saves at once. The next resume built uses the change; nothing else has to be updated. Milestone 1.

**Scenario C: a tailored one-page resume from a pasted job.**
The author pastes a job description. Scout pulls the job's keywords, ranks every eligible point against them, picks three to four points per job and three per project, and swaps in the alternate wording whose terms the job mentions. Keywords the profile does not support (say, Kubernetes) are listed as "not in your profile, so not added" and never appear. Projects are added in order of relevance while the page still fits; the weakest is dropped to stay on one page. The Languages row stays first. Scout builds the resume source, compiles it, confirms one page, extracts the text to check order and characters, and looks at the rendered page. The result ends with a fit rating out of 10 and the real facts that would raise it. Milestone 2.

**Scenario D: the daily discovery run.**
Scout holds a list of forty companies and the kind of job board each uses. Every few hours it polls each board, compares with what it has seen, and stores only new or changed postings. A hundred new postings come in. Duplicates and reposts are merged, postings that fail hard rules (wrong country, below the salary floor, wrong seniority, an excluded company) are dropped with the reason recorded, and the rest are ranked by how well their words match the profile. Thirty remain. This run uses no model call. Milestone 3.

**Scenario E: scoring and the shortlist.**
Of the thirty, the twenty best are sent to the model in one batched request. The reply scores each for eligibility (could I really get this) and desirability (do I want it), with three to five reasons and a list of unmet requirements. Anything with an unmet must-have is moved down. The result is cached by job content and profile version, so tomorrow's run does not pay for the same job again. Fifteen reach the shortlist. Milestone 4.

**Scenario F: the model proposes a wording and the check blocks a bad one.**
For a shortlisted job, the model is asked for a better wording of one bullet using only the terms listed on that point. It proposes "led a team of eight". A separate check extracts every claim and compares it to the profile, which says the author mentored two juniors. The check blocks it. A corrected proposal passes and waits in the Profile view as a pending alternate wording; it is used in a resume only after the author approves it. Milestone 4.

**Scenario G: the morning digest.**
The author opens the Digest. Fifteen cards show job, score, reasons, what is missing, the one-page resume preview and the answers to approve. The author approves ten with one keystroke each, skips three tagging "too junior", "bad location" and "unknown company", and edits one answer. The skip tags are stored and tighten the filters. Cards older than a set number of days expire on their own. Milestone 5.

**Scenario H: choosing how Scout applies.**
In Settings the author picks "Wait for my approval" as the default, sets Greenhouse to "Fill, I submit", leaves a board with no clean runs at "Prepare only", sets a daily application limit of ten, and turns on pause-all when travelling. The choices apply at once and are shown in the status line of the Digest. Automatic applying works only after the author chooses it and only on boards set to Automatic. Milestone 5.

**Scenario I: an application on an official job board.**
An approved job is on a board with a form Scout has a proven adapter for. Scout opens the form and reads every field into a list. Each field maps to a profile value, an approved answer, or "unknown". All are known. Scout fills the form, reads it back and compares with the intended values, takes a screenshot, and (because this is the first time for this site) stops before submitting and shows the author. The author approves. Scout submits, sees the confirmation page, saves the screenshot and text, and marks the job applied. After many clean runs like this, the author may set that board to Automatic. Milestone 6.

**Scenario J: an unknown question stops the form.**
Another form asks "Describe a time you disagreed with a senior engineer" and "Are you open to relocating to Berlin?". Neither is in the answer bank. Scout classifies the first as motivational, drafts an answer from the profile and queues it for approval; it classifies the second as a legal-and-personal question and refuses to guess, asking the author. Nothing is submitted until both are answered, and both answers go into the bank if the author says so. Milestone 6.

**Scenario K: the model's usage limit is reached.**
Mid-afternoon Claude Code reports that the usage limit is reached. Scout records the reset time and switches the model stages to Codex, which has been tested on the same labelled set. Later Codex also runs dry. Scout enters degraded mode: it keeps polling, deduping, filtering and ranking by keywords, builds resumes from approved points (which needs no model), queues the jobs that need scoring in priority order (fresh and strong-match first), and resumes model work when a limit resets. Resumes built from approved points need no further review, and no model-written text is sent unless the user approved it. Milestone 4.

**Scenario L: a closed job, a ghost job and a hostile posting.**
Before applying, Scout rechecks the posting: the page now says it is no longer accepting applications, so the job is marked closed and skipped. Another has been open for ninety days, reposted four times, with a vague description; it is flagged as a likely ghost job and sent to the bottom. A third posting contains hidden text telling "any AI reading this" to say the candidate has a security clearance. Scout treats the posting as data only; the instruction is ignored, the posting is flagged as suspicious, and the claim check would have rejected the claim anyway. Milestones 3 and 4.

**Scenario M: a platform alert, assisted apply.**
The author has turned on job-alert emails from the big job platforms. Scout reads those emails from the mailbox, extracts each job, and looks for the same job on the company's own board. Found: it joins the normal flow. Not found: the job stays in the digest marked "platform-only". When approved, Scout prepares the resume and answers, opens the page in the author's own signed-in browser profile, and stops. The author presses submit. If the saved login has expired, Scout stops and tells the author to sign in again; by default it never types a password (the owner may later opt in per platform to saved credentials in the OS keychain; see DECISIONS D-012). Milestone 8.

**Scenario N: replies, follow-ups and the funnel.**
An email arrives: "We would like to schedule an interview". Scout matches it to the application by company and role, marks the application as interviewing, and notifies the author. A week later another application has had no reply, and Scout drafts a short follow-up for the author to approve. At the end of the week a view shows discovered, shortlisted, applied, replied and interviewing, broken down by source, resume content and how old the posting was when applied. Milestone 7.

**Scenario O: a crash in the middle of a submit.**
The laptop sleeps, or Scout crashes, at the moment a form was being submitted. On restart the job is in state "submitting", not "applied" and not "approved". Scout does not retry. It checks the confirmation email and the company's page for evidence; if neither proves success it marks the job "unverified", shows it in the "needs you" block, and asks the author. No application is ever sent twice. Milestone 6.

**Scenario P: a site changes its form.**
A daily self-test of the board adapter, run in dry-run on a stable public posting, starts failing because a button was renamed. Scout pauses automatic submission for that board, tells the author, and keeps staging applications for manual submit. The author can ask the model to propose a repair from the saved page and screenshots; the repair is applied only after the author approves it and passes the saved-page tests again. Milestone 6.

---

## 5. Features and behaviors

Each item is written as something a user can observe and test. Mechanisms are named only in parentheses.

### 5.1 The profile (the single source of truth)

- One structured profile holds: identity and contact details; education; a short summary; skills grouped in rows; work history with dates, titles, employers and places; projects with a stack, links and an optional status note such as "in development"; and preferences in four weights (must have, strong preference, nice to have, hard no).
- **Points are stored once.** Every experience point and every project point is one record. A resume never contains text that is not one of these records or one of their approved alternate wordings.
- Every point carries:
  - its **wording**, in plain words, written as what was built, the problem it solves, and the non-obvious decision behind it;
  - its **status**: `confirmed` (the user states it); `from code` (read from the user's own project and checked at a recorded date, so a dated snapshot and not a current test result); `ask first` (a fact the user has removed or flagged before, which is never used silently and appears on a job's card for a yes or no); `hold` (unresolved or unmeasured, so never used automatically); or `excluded` (never used in any resume, email or profile, kept only as a record);
  - its **terms**: the technologies and skills the user confirms are true for this point (for example Kafka, WebSockets, rate limiting);
  - its **alternate wordings**: zero or more rewordings of the same fact, each with the job terms that trigger it. An alternate wording may only use terms from the point's own list.
- **Evidence rules.** Code proves what was implemented, not who owned it, whether it ran in production, or what it achieved. A design goal is not a measured result. A tutorial-derived part is attributed honestly. A shared result carries team credit. Held and excluded points stay out of every resume, and ask-first points are used only after a yes for that job. A job description never establishes a skill, title, number or project.
- **Permanent exclusions** are recorded in a locked "never used" list shown on the Profile view: items the user has decided never to use, and items that may be added only for one named job at the user's request. Scout never reconsiders them on its own. An exclusion may name one job where it is allowed; the exception covers only that job.
- **Corrections win.** When the user corrects a fact, the newest statement replaces older wording everywhere, and the profile version number goes up.
- An **answer bank** holds approved answers to recurring form questions (notice period, work authorization, salary expectations, "why do you want to work here" skeletons, links, demographic questions). Each entry has a type (factual, personal, motivational, legal, demographic, salary), a source (the user wrote or approved it), and the date approved. Only approved entries are used without asking.
- Demographic and equal-opportunity questions are answered only as the user has set them, by default "prefer not to say". They are never inferred.
- **No fixed personas.** Every job re-ranks the whole eligible inventory afresh; an earlier job's choices are never copied. The summary can carry alternate wordings the same way a point does.
- **First-run setup and the gate.** Scout interviews the user before anything else runs: target roles, locations and remote rules, salary floor, notice period, work authorization, languages, dealbreakers, companies to exclude, and what they want less of. It flags every gap. No stage of the pipeline runs until the required fields exist.
- **Years of experience** are kept as dates, with full-time and internship months counted separately and overlapping months never counted twice; Scout never states a single total unless the user asks for one.
- The profile has a **version**. Any change bumps it. Every score, resume and application records the version it used.

### 5.2 Understanding the user's projects once

- Scout can read one of the user's repositories end to end (the documentation, the configuration, the code, not the commit history) and write one **verified note** for it: what it is, whether it is real, a tutorial-derived copy, a demo or unfinished, the real stack, each feature with how it works, the design decisions and their reasons, edge cases and failure handling, its status (built, half-built, only described), real numbers only, and a "do not claim" list.
- The note checks every README claim against the code. It does not run unknown code, install dependencies, or change the repository.
- Profile points for projects are written from these notes and from the user's own statements. A project's tutorial-derived parts and known defects shape what may be claimed.
- Once a project has a note, Scout does not read it again. It rereads only when the user asks, or offers to when the repository has changed since the note was written.
- Work the user did for an employer is read from their own commits in that repository, and only their authored work is claimed; a teammate's files stay unclaimed.

### 5.3 The Profile page (view and edit by hand)

- The Profile view shows the whole profile as a plain page: contact details, summary, skills rows, each job with its points, each project with its points, education, and the "never used" list.
- Any field can be edited in place. A point opens into a form with its wording, its terms, its status, and its alternate wordings (each with the job terms that trigger it). The user can add or remove points, alternate wordings, jobs and projects. Removing needs a second click.
- Every save is stored at once and bumps the profile version. A "reset to sample" is available.
- **Tailor preview.** The user pastes the keywords of a job and sees, live, which points would be used for each job and project, which alternate wordings would replace the base wording, the keywords highlighted, how many keywords the profile supports, and the keywords it does not support, which are named and not added.
- **Resume preview.** Below the keywords the page shows the one-page resume as it would be built, with an estimate of how full the page is, the projects shown and the projects left out, the resume source ready to copy, the compiled PDF once the local program has built it, and the file name the resume will get.
- The page works the same at phone width and in light and dark themes.
- Model proposals (a new wording, a point drafted from a project note) appear on this page as **pending** and change nothing until the user approves them.

### 5.4 Sources

Sources are ranked by how much they can be trusted.

- **Tier A: official job boards run by applicant-tracking systems** (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee and similar), read from their public listing feeds. Structured, fresh, with the real apply link. The best source and the only one Scout applies through automatically.
- **Tier B: company career pages** with their own software, read from structured job markup in the page or its sitemap where present, or from the page itself. Good data; many need an account to apply and are staged for manual submit.
- **Tier C: free aggregators and feeds** (remote-job boards, community "who is hiring" threads, RSS and public search feeds). Wide, with duplicates and stale posts; every hit is resolved to the company's own board when possible.
- **Tier D: platform alert emails** from the big job platforms, read from the user's own mailbox. This is how those platforms are used for discovery without scraping or automating them.
- **Tier E: manual adds.** The user pastes a link, a job description or a recruiter's message, and the same pipeline processes it.
- **Company-first discovery.** Scout keeps a list of target companies and detects which job board each uses from its careers address. Companies found through alerts, community threads or the user are offered for addition. Polling the company's own board directly beats keyword search because postings appear within hours and noise is low.
- Every source records its health: last successful fetch, jobs seen, duplicate rate, freshness, and later the reply rate. Good sources are polled more often. A source that suddenly returns nothing raises an alert.
- Scout respects each site's published rules for automated access and rate limits, and identifies itself honestly in requests.

### 5.5 Normalizing, deduping and freshness

- Every posting becomes one record: title, company, location and remote type, salary range with currency and period, seniority, required and preferred skills, description, posted date, source list, the canonical apply link, the board type, and a saved copy of the raw text.
- **Dedupe in layers:** identical canonical link; then same company, title and location; then high text similarity. One job found on five sources is one record with five source entries, and the official-board version wins.
- **Reposts** of the same job under a new date are recognised and not treated as new.
- **Freshness.** Each job has first-seen and last-seen times. A job that disappears from its board becomes closed. Just before any application, the page is checked again and a closed or redirected posting is skipped.
- **Ghost-job signals.** Long-open postings, repeated reposts, vague text, no salary where one is customary, and recruiting-agency patterns lower a job's rank and are shown to the user.
- **Scam signals.** Requests for fees, contact only through a messaging app, an employer with no footprint, and mismatched company names are flagged and never applied to automatically.
- Newer jobs are favoured, on the assumption (not proven) that early applications are seen more often.

### 5.6 Deciding whether to apply

A job moves through filters in order of cost, and every decision has a recorded reason.

1. **Hard rules (no model):** location and remote policy, work authorization, salary floor, seniority range, years of experience required against the user's (full-time and internship months counted separately, overlapping months never counted twice), required languages, excluded companies and industries, companies already applied to within a cooldown, and the user's blacklist.
2. **Keyword and skill match (no model):** a ranking by how well the posting's words match the profile's terms.
3. **Model scoring (batched):** for the best candidates only, the model extracts requirements as must-have and nice-to-have, marks each as met, unmet or unknown with evidence from the profile, and returns two scores: **eligibility** (could I plausibly and legally get this) and **desirability** (do I want it), with short reasons and red flags. The two scores combine into one shortlist score shown on the card.
4. **Decision with a confidence band:** high fit and high confidence goes to the shortlist; middle stays at "found" and appears in a review list in the Digest; an unknown on a hard requirement becomes a question to the user, not a guess; low fit is skipped with the reason recorded.
5. **Calibration.** The user's approvals and skips are compared with the scores over time. If the user rejects most high scores, the threshold or the instructions to the model are wrong and Scout says so.

### 5.7 Building the resume

The resume is built from the profile by a fixed method, and the same method is used for a pasted job and for a discovered one.

- **Fixed layout.** One page, single column, plain text that a machine can read, standard section headings in this order: contact details, summary, technical skills, experience, projects, education. The layout and spacing are fixed. The page fills itself: spare room is shared out between sections in set proportions, so section gaps are always wider than entry gaps and entry gaps wider than bullet gaps. Scout never shrinks the font, never changes the margins and never changes the spacing to make content fit. If the content is too long it removes or shortens content, starting with the weakest project.
- **Selection per job.** Scout reads the job's keywords and responsibilities, ranks every usable point against them, and picks the strongest: three to four points per job, three per project (four only when the page allows), and three or four projects by default, a fifth only when the page still fits cleanly, most relevant project first. Points keep the order the profile stores them: a job's first usable point is its headline (core work, product, team size once) and is always kept, the measured result comes next, and a project's first point is its one-line scope. Selection decides which points appear, not their order. Direct evidence beats adjacent evidence. A point that only restates another is dropped. Employment stays in date order, and a real job is never dropped to fit a project. Points marked `ask first` are offered to the user on the job's card (or in the resume preview, for a pasted job) and not used until they say yes.
- **Keyword wording.** For each chosen point Scout uses the base wording, or an alternate wording whose trigger terms the job mentions, whichever matches better. The page highlights matched keywords in the preview. Terms the job asks for and the profile does not hold are listed to the user and are not added. Related evidence may show transferability but is never renamed as the requested skill. Skills rows are ordered by relevance with the Languages row first and matched items first within a row.
- **Writing rules.**
  - Each bullet says what was built, the problem it solves, and the non-obvious decision behind it.
  - A feature every app of that kind has is not a bullet.
  - Internal mechanism, library lists and codenames stay out of bullets; technology lives in the skills rows and project stack lines.
  - Plain words, one idea per bullet, varied opening verbs, no absolutes ("never", "guaranteed"), no repeated achievement anywhere on the page.
  - A shared result credits the team. A design goal is not written as a measured result.
  - An approximate figure stays approximate, with its baseline ("about 17,000 to 4,000"); arithmetic is done only between compatible confirmed figures. A major technology name appears at most once per job and small libraries never appear in experience points.
  - Banned: empty praise words ("results-driven", "passionate", "spearheaded", "leveraged"), invented numbers, placeholders, and filler.
  - The summary opens with the plain, general name of the user's profession as set in the profile (the author's is "Software Engineer"), never a narrower specialty; the job entries below keep the real titles. It is two to three lines, repeats no achievement from below, and has no goal line.
  - Job titles are the real titles, written in full; company names are written in full; dates use one format.
- **Claim check on any model-written text.** Before a proposed wording, drafted answer or note can be shown for approval, Scout extracts every claim in it (a skill, tool, number, title, date, scope) and looks each one up in the profile and the point's own terms. Any claim it cannot support blocks the text; the model is told which claim failed and asked again; after a set number of failures the text goes to the user instead. Text the user wrote or approved is not re-checked.
- **Checks before the resume is shown.**
  - Every sentence resolves to a usable point or its approved alternate.
  - The text compiles, the page count is one, the extracted text reads top to bottom in section order, special characters are intact, and the rendered page is looked at for overlaps, clipped links, stranded headings, and bullets that end with one to three stranded words on a second line, which are shortened and rebuilt.
  - Scout says "one page, inspected" only after it has compiled and looked. If it cannot compile, it says so and returns the source.
- **Fit rating.** After every resume built for a job, Scout gives a score out of 10, a short table rating each core requirement with the evidence on the page, and at most three real facts the user could confirm that would raise it. It is a judgment of fit to that job, never called an applicant-tracking score or a prediction of an interview, and rewording is never offered as the cure for a missing fact. Reading the job's requirements for the rating is model work; with no model available the rating is reported as unavailable and is not faked from keywords. It is separate from the shortlist score in 5.6: the shortlist score decides whether a job is worth the user's attention, and the fit rating describes how well the finished resume fits it.
- **What the machine-reading checklist is.** Single column, standard headings, contact details in the body, no tables, text boxes or images, plain text PDF. Scout does not claim that any resume "passes the ATS" or has a "match score"; the only automatic rejections that are documented come from knockout questions on application forms, which Scout answers from the answer bank.
- Building the resume needs no model call. Only the user's approved wordings are used. The model may be asked to propose a new wording, which stays pending until approved (5.3). Only the fit rating needs the model; with none available, it is reported as unavailable.

### 5.8 The approval digest

- The Digest view shows a short ranked list of cards: job, company, shortlist score, the resume's fit rating, reasons, unmet requirements, the resume preview, the answers that will be used, and the source and age.
- Approve and skip are single keystrokes, with batch approve for low-risk items. Risky items (new board, unknown question, low confidence) are visibly flagged and never batch-approved.
- Skips take a short tag ("wrong location", "too junior", "company", "not interesting"). Tags feed back into the filters and the labelled set.
- Cards expire after a set number of days, because stale jobs are worthless.
- Things that need the user (a login expired, a question to answer, a blocked check) sit in a separate "needs you" block at the top, apart from information.
- The status line shows the date, the current apply mode, whether automation is paused, how many sources are healthy, model calls used today, and the next run. A macOS notification announces the digest. There is one digest a day, not one alert per job.
- The Digest, the Profile and the Settings are three views of one page, reachable by name in the address.

### 5.9 Settings

The Settings view holds the choices the user makes about how Scout behaves. Each saves at once.

- **When Scout applies:** wait for my approval (default); apply automatically on trusted boards; prepare only.
- **Dry run first on new boards:** fill and stop before submitting until a board has a clean record.
- **Daily application limit** and **minimum score for the shortlist.**
- **Per board:** Prepare only, Fill I submit, or Automatic, with the number of clean runs shown. Automatic takes effect only when the apply mode allows it.
- **Big job platforms:** whether to read their alert emails. Applying on them is never automatic, and the page says so.
- **Model:** the main engine (Claude Code or Codex), switching engine when a limit is reached, and the daily call budget.
- **Notifications and follow-ups:** digest time, desktop notification, and how many days without a reply before a follow-up is drafted.
- **Form answers:** demographic questions set to "prefer not to say" or "ask me each time".
- **Safety:** pause all automation, and reset to defaults.

### 5.10 Applying

Applying has three levels, and a board or question pattern moves up only by proving itself.

- **Level 0, Prepare only (staged).** Scout prepares everything and the user submits by hand.
- **Level 1, Fill I submit.** Scout fills the form and stops before the final submit; the user presses it.
- **Level 2, Automatic.** Scout submits after approval, and later without per-job approval for a specific board once it has a clean record in Level 1.

How it behaves by case:

| Case                                                      | Behavior                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official board with a proven adapter                      | Read the form's fields, map each to a profile value, an approved answer or "unknown", stop if any required field is unknown, fill, read back and compare, screenshot, submit, verify.                                        |
| Email-only apply                                          | Draft the email with the resume attached for the user to send from their own mail program. Scout never sends mail; its mailbox access is read-only.                                                                          |
| Platform's built-in "easy apply" buttons                  | Never automated. Staged for manual submit in the user's own signed-in browser.                                                                                                                                               |
| Company site that needs an account or a multi-page wizard | Staged. The user creates any account themselves.                                                                                                                                                                             |
| Sign-in wall, one-time code, or bot check (CAPTCHA)       | Stop and mark "needs you". Never solved, never bypassed.                                                                                                                                                                     |
| Custom question                                           | Classify (factual, personal, motivational, legal, demographic, salary). Factual and in the bank: use it. Motivational: draft and ask. Legal, personal, salary or demographic and not in the bank: ask the user, never guess. |
| File requirements                                         | Provide the requested file type; fail safely if refused.                                                                                                                                                                     |
| Assessment, take-home or video interview request          | Detected and handed to the user.                                                                                                                                                                                             |
| Job closed, or the form differs from the saved shape      | Abort, record, skip or retry later.                                                                                                                                                                                          |
| Outcome unclear                                           | Count as "applied" only with evidence (confirmation page text, or a confirmation email matched by company and role). Otherwise "unverified".                                                                                 |

- **Dry run mode** does everything except the final submit. It is on by default for every new board.
- **Form snapshot first.** Before any fill, the whole form is saved as structured data; later runs can be compared to see if the form changed.
- **Two-pass fill.** After filling, the form is read back and compared with what was intended; any mismatch stops the submit.
- **Idempotent submit.** A job moves to a "submitting" state before the final click, and an interrupted submit is never retried blindly (Scenario O).
- **Self-tests.** Each board adapter has a daily dry-run test on a stable public posting; a failure pauses automatic submission for that board (Scenario P).
- **Repairs.** When an adapter breaks, the model may propose a patch from the saved page and screenshots; it goes live only after the user approves it and the saved-page tests pass.
- **Limits.** A daily cap on applications, a per-site rate limit, pauses after repeated failures on one site, and a kill switch that stops everything.
- **Asks first.** Scout never applies, sends a message, posts, or changes the user's profile on any site without a clear yes from the user for that specific action. A yes for one job does not cover another. Filling a form is allowed; the final click needs the yes unless the board is set to Automatic.

### 5.11 Job folders and evidence

- **One folder per job.** Each job touched gets a folder named with the date it was created, the employer (not a recruiting agency) and a short role name. It holds a record of the job (status, link, platform, who posted it), the **job description saved word for word the moment the job is first touched** (so interview preparation never depends on a live page), fit and gaps, the choices made for that resume, recruiter contact, outreach log, interview notes and a dated log. Folders are never renamed.
- **Status** comes from one list for the whole system: found, shortlisted, resume-ready, approved, submitting, applied, then contacted, interviewing, offer, rejected; and the side states skipped, needs-you (a person must act or decide), unverified (a submit that could not be proven), failed, closed and withdrawn. "Applied" is set only with evidence. A board table of every job and status is generated from these records.
- **Exact files sent.** The tailored resume source and PDF are saved in the job's folder, and at apply time the exact PDF sent is copied there and named in the record, so interview preparation uses what the recruiter actually has even after the profile changes.
- Every application also stores: the job as seen, the form snapshot, the values filled, a screenshot before submitting, the confirmation page or email, timestamps, the profile version, and the reasons it was chosen.
- Dates are always written as absolute dates. Unknown fields are written "unknown", never guessed.
- A readable per-day log says what Scout did and why. A single view answers "what did the bot do today?".
- Evidence is kept locally and can be deleted by the user at any time.
- **Leads** found but not yet pursued are saved as dated lists per source and per round, each with a status column (blank, applied, skipped), and a lead becomes a job folder only when the user picks it.

### 5.12 The model budget and the brain

- The brain is **Claude Code or Codex**, called from the command line in non-interactive mode on the user's existing subscription. There is no API key and no other model.
- **Funnel first.** Hundreds of jobs become dozens by rules and keyword ranking before the model sees any.
- **Batching.** Many jobs are scored in one request, returning a structured list.
- **Caching.** Results are keyed by content, profile version and instruction version; the same input is never paid for twice.
- **Daily call budget** and a **priority order**: proposals the user is waiting on first, then scoring fresh strong matches, then the rest.
- **Structured output only.** Every reply must match a fixed shape; anything else is discarded and retried once, never guessed at.
- **Two engines.** The instructions and shapes work the same for Claude Code and Codex; both are tested on the labelled set. If one reports its limit, the other takes over (Scenario K).
- **Degraded mode.** Without any model, discovery, dedupe, filtering, keyword ranking, resume building from approved points, and tracking continue, and the scoring queue waits.
- **Limit awareness.** A reported limit and its reset time are recorded; model stages pause until then, other stages continue.
- The model only produces data. It never clicks, sends or runs anything; only Scout's own code touches the browser, the mailbox or the files.
- The user is told to check their plan's terms for automated use before running Scout continuously.

### 5.13 Tracking replies and learning

- Scout reads the user's mailbox in read-only mode and classifies messages: application received, recruiter message, interview invite, assessment, rejection, offer. Simple rules handle most; the model handles ambiguous ones. Each message is matched to its application.
- **Follow-ups.** After a set number of days with no reply, Scout drafts a short follow-up for the user to approve and send. Messages follow set formats: an email to a recruiter is about 150 words, one sentence on where the user works and what they build, one line on personal projects with one link, availability, "resume attached", a sign-off, no feature lists; a connection note is under 300 characters. Drafts only; the user sends them.
- **Recruiter contacts** are public professional details only: the person named on the posting, a profile (found through public web search results, not by browsing a platform) counted only when the name and the firm both match, a work email only if it is published (with its source), a pattern guess labelled unverified, and the firm's public hiring inbox as a fallback. No paid email finders, no personal phone numbers or addresses.
- **Funnel.** Discovered, shortlisted, applied, replied, interviewing, offered, broken down by source, the points used, company size and the age of the posting when applied.
- **Feedback.** Every skip, edit and override is stored as a labelled example. Reply rates change how sources are weighted.
- **Interview preparation.** When an invite arrives, Scout builds a plan from the saved job description and the exact resume sent: the job's core requirements by weight, the user's matching stories from that resume, the gaps with an honest way to answer each, likely rounds with practice questions, and questions the user can ask. Notes from each round are added.
- A small contact list records recruiters and referrals.

### 5.14 Logged-in platforms and sessions

- Scout never asks for, stores or types a password for any job platform, and the model never sees one.
- Where a login is needed (the assisted apply of Scenario M), the user signs in by hand, once, in a dedicated browser profile used only by Scout. Scout reuses that session.
- A session check runs before use. If the session is gone, or a code or challenge appears, Scout stops and asks the user to sign in again.
- The dedicated profile folder is treated like a key: restricted to the user, excluded from backups and version control, and deletable at any time.
- Automating the big job platforms can get an account banned. Scout therefore uses them for discovery by email alert and for assisted manual submit only, never for automatic applying. On those platforms Scout opens only the single job link that an alert or the user supplied; it does not search, scroll, page through or scrape them.
- Each job site that permits automated access has its own short notes (how its pages and feeds are read, how its apply button behaves, rate limits, confirmation text), written from real use and corrected whenever a check shows they are wrong. For the big platforms the notes record only what the user saw and did by hand.

### 5.15 Trust and safety

- **No invented facts.** Generated text is checked against the profile (5.7).
- **Data is not instructions.** Posting text, page text, email text and everything saved from outside are data. A posting that tells the model what to do is flagged and ignored. No page content can change what Scout does.
- **Earned automation.** New boards and new question patterns start staged and move up only after a clean record.
- **"I do not know" is a valid result.** Unknown becomes a question to the user. When Scout is unsure of a fact, a match, or what the user wants, it asks, grouping questions, and keeps doing the parts that do not depend on the answer.
- **Honest status.** Scout reports what actually happened ("the site showed Application sent"), not what should have; a skipped or failed step is said plainly.
- **Hard action limits.** Scout's code is the only thing that acts, through a short fixed list of actions. A kill switch stops everything at once.
- **Honest conduct.** Scout never bypasses a CAPTCHA or bot check, never applies where the user is not eligible, never fakes experience, and answers sensitive questions only as the user has chosen.
- **Pace.** A daily cap and per-site limits keep volume to what a person could plausibly do.
- **Privacy.** Data, models and files stay on the machine. Secrets are never in logs or in version control.
- **Precedence.** When instructions conflict, the user's current message wins, then Scout's fixed rules, then the user's standing preferences, then the defaults of a workflow.

### 5.16 Operations and health

- A local status area shows: last successful fetch per source, model calls used today and when limits reset, queue sizes by state, failing adapters, session status, today's applications and anything waiting for the user.
- **Config as a file:** sources, caps, thresholds, schedule and per-site levels, changed without touching code and logged when changed. The Settings view and this file are one store: a change in either appears in the other.
- **Always running.** A background service starts at login and restarts after a crash; every step reads its state from the database and resumes where it stopped. A heartbeat alert fires if Scout has not run for a day. Sleep and wake are handled.
- **Backups.** The database, the profile and the evidence folder are backed up on a schedule to a place the user chooses.
- **Replay.** Any past job can be rescored with today's instructions to see what would change.
- **Shadow mode.** New scoring instructions or models run beside the old ones and are compared before replacing them.
- **Observability.** Counts per day and per source: fetched, new, deduped, filtered (by reason), scored, shortlisted, approved, applied, verified, failed, needs-you, model calls, limit hits.
- The user's settings and profile are plain, readable and portable: moving to another machine means copying them.

### 5.17 Testing and evaluation

- A **labelled set** of real jobs (apply, maybe, skip) with the user's own labels measures the scorer's precision and recall at the chosen threshold. Any change to instructions or engine must pass it before going live.
- A **saved-form set** (saved pages of real application forms) tests every adapter with no network: the field list, the mapping, the fill, the read-back.
- A **fake model** replies from recordings so every scenario runs in automated tests checked on properties (the right jobs reach the shortlist; no unsupported claim reaches a built resume; no job is submitted twice after a crash; no model is called in degraded mode), never on exact wording.
- **Resume checks are tested on properties:** every generated resume is one page; the Languages row is first; no held or excluded point appears; no ask-first point appears without a yes for that job; no term outside a point's list appears in its alternate wording; a job keyword the profile does not hold never appears; and with no keywords the output equals the plain stored wording.
- The verifier, the dedupe rules and the parsers are tested on malformed and hostile input, including postings that contain instructions.
- **Measured targets**, chosen by the user: form fill accuracy near perfect, applications the user would have rejected near zero, scorer precision at the threshold above a stated number, resumes at one page every time, and daily attention under ten minutes.
- Runs against real sites are a manual smoke check with a short written procedure; they never gate automated tests.

---

## 6. Non-goals

These will not be built. If any of them seems to be creeping in, stop.

- In version 1, any paid service, paid job-data API, or any model other than Claude Code or Codex.
- Automatic applying through LinkedIn, Indeed, Naukri, Glassdoor or any platform that forbids automation.
- Storing, handling or typing passwords; solving or bypassing CAPTCHAs, one-time codes or bot detection; creating accounts for the user.
- Mass applying, "spray and pray", or hiding the automation from a site.
- Inventing or exaggerating experience, credentials, numbers or dates, or adding a skill to a resume only because a job asks for it.
- Keyword stuffing, hidden text, or any claim that a resume "beats the ATS" or has a match score.
- Automating assessments, take-home tests, video interviews, salary negotiation or offer decisions.
- A multi-user, hosted or team version; Scout runs for one person on one machine.
- A general resume designer or document editor: there is one fixed layout, and only content varies.
- Resume layouts that need more than one column, images, or tables.
- A learned ranking model in version 1; rules and the model's scores are used until there is enough outcome data.
- Any feature whose only justification is "LazyApply has it".

---

## 7. Constraints and environment

The planning chat cannot know these; they are fixed.

- **No new spend.** Free software, free public job feeds, and the existing Claude Code or Codex subscription. "Free" here means no extra charge, not unlimited: the subscription has usage limits, and the design treats model calls as a scarce budget.
- **The model is a command-line tool.** It is called non-interactively and its output is checked. Its flags and limits can change, and its limit behavior differs between the two tools; the design assumes nothing about numbers and detects limits at runtime.
- **Terms of use matter.** The user must check their plan's terms for continuous automated use. Job platforms forbid automation; Scout stays inside that by design (5.14). Official company boards are the intended automation targets.
- **Everything runs on the user's laptop.** It is a personal machine that sleeps, so the system must resume safely and, if the user wants true all-day running, can be moved unchanged to a spare machine.
- **Platform.** The first target is macOS on Apple Silicon (system notifications, a login-time background service); the same steps should work on Linux.
- **Pages change without notice.** Job boards and forms are expected to change. Each board adapter is small, isolated, covered by saved-form tests and a daily self-test, and fixable alone.
- **Sources are public, uneven and sometimes wrong.** Dates, salaries and locations are missing or inconsistent; the design records uncertainty instead of hiding it.
- **The mailbox is read through its standard open protocol,** which the user's provider must allow (often by an app-specific password, which is kept in the system's secure store and never in a file, a log or a prompt). Access is read-only.
- **The model never acts.** It returns structured data; Scout's code is the only actor.
- **The resume is a document in a typesetting language (LaTeX) compiled to a PDF.** The layout is one fixed template with a fixed preamble; only the content between the start and end of the document changes. The page's spare space is shared out by stretchable gaps, which is what makes it fit any amount of content. The user needs a LaTeX installation on the machine to compile; a browser cannot compile it or save files, so the Profile view shows the source and a preview, and the compiled PDF is produced by the local program, which then shows it.
- **Page fit is judged two ways.** A fast estimate from text length decides how many projects to include (calibrated against a real one-page resume), and the real check is the compiled page count. The estimate can be wrong; the compile is the proof.
- **Language: one language for the whole program.** Default is Python, because crawling, documents and email handling are strongest there (open decision 1).
- **One local database file, one local web page with three views, one background service.** No servers to run, no containers.
- **Testing is required for every phase.** Each milestone ships with its saved-page and fake-model runs passing and a manual demo. The bugs here (a double submission after a crash, an unsupported claim in a resume, a silently broken adapter, a two-page resume) appear only in rare sequences.
- **The author already has a working resume system.** It supplies the layout, the writing rules, the evidence statuses and the fit rating described in 5.1 and 5.7. This document restates what is needed; the build should reproduce that behavior.
- **Author context.** A backend developer preparing for system-design interviews, comfortable with services and databases and newer to browser automation, form handling and evaluating model output. The state machine, idempotency, dedupe, budgeting and evaluation are the learning; the plan should assume this reader.

---

## 8. Milestones

Stated as "what works after this phase, proven by", in build order. Each phase is one feature finished end to end, integrated, with its tests passing, before the next starts. No phase leaves a half-built feature for a later one.

1. **Profile, Profile page and the spine.** The structured profile with statuses, terms, alternate wordings, versions and the "never used" list; the basic command-line bridge to Claude Code and Codex (structured replies and limit detection), which milestone 4 later extends with batching, caching, budgets and fallback; the claim check over model-written notes and drafts (5.7); the project-reading step that writes verified notes; the first-run interview; the Profile view with hand editing and the tailor preview; the database with the job state machine and the action log; the kill switch, config file and dry-run flag (built first so nothing ever acts unprotected); a command-line program. _Proven by:_ Scenarios A and B; a test that every state change is recorded and that an interrupted step resumes without repeating; a test that a held or excluded point never leaves the profile view as usable and that no ask-first point is used without a yes.
2. **The resume builder.** The fixed template, selection per job, keyword wording from approved alternates, "not in your profile" reporting, the page-fit estimate, compile, one-page check, text extraction check and rendered look, the file name and job folder, and the fit rating. Building the resume uses no model; the fit rating uses the model to extract the job's requirements and is reported as unavailable, never faked, when no model can be reached. _Proven by:_ Scenario C; the resume property checks in 5.17; real compiles of generated resumes at one page across several different job keyword sets, including one where the estimate drops a project.
3. **Discovery, dedupe, freshness and hard rules.** Polling of the official boards for a company list, board detection, normalization, layered dedupe, repost handling, closed-job detection, ghost and scam flags, hard-rule filters with recorded reasons, and keyword ranking; saved job descriptions and job folders. _Proven by:_ Scenarios D and L (closed and ghost parts) against saved board responses; a property check that the same job from five sources becomes one record; zero model calls in this phase.
4. **The brain, scoring, proposals and the budget.** Extending the bridge from milestone 1 with batched scoring with eligibility and desirability, caching, the daily budget and priority order, engine fallback and degraded mode, pending proposals for new wordings, untrusted-text handling, and the labelled set with its measurements. _Proven by:_ Scenarios E, F, K and the hostile-posting part of L against a fake model; the labelled set's precision and recall reported for both engines; a property check that no proposed wording reaches a resume before approval.
5. **The approval digest and settings.** The Digest view, ranked cards, keystroke approve and skip with tags, batch rules, expiry, feedback into filters, and the Settings view with every choice in 5.9. _Proven by:_ Scenarios G and H; a test that risky items can never be batch-approved; a test that Automatic has no effect unless the apply mode allows it.
6. **Applying on one official board, then two more.** The adapter contract, form snapshot, field mapping, answer classification, two-pass fill, screenshot and evidence, dry run, level promotion, idempotent submit, post-submit verification, daily self-test and repair flow; first one board, then two more through the same contract. _Proven by:_ Scenarios I, J, O and P against saved forms and a fake form site; property checks that no job is submitted twice after a crash and that an unknown required field always stops the submit.
7. **Tracking, follow-ups, interview preparation and the funnel.** Read-only mailbox, message classification, matching to applications, follow-up drafts, recruiter contact lookup, interview preparation from the saved job description and the resume sent, funnel views, and feedback into source weights. _Proven by:_ Scenario N on saved messages; a test that every reply matches the right application or is shown as unmatched.
8. **Platform alerts and assisted apply.** Parsing alert emails from the big platforms, resolving to the company's own board, the dedicated browser profile, session checks, and staged manual submit. _Proven by:_ Scenario M; a test that no step ever types a password or submits on a platform.
9. **Health, backups and polish.** The status area, the background service with restart and heartbeat, backups, replay and shadow mode, and the end-to-end demo. _Proven by:_ the north-star demo over a week of real use.
10. **Optional later.** A local model as an extra fallback brain behind the same shapes; more boards; a mobile notification channel; re-reading a project when the repository has changed.

---

## 9. Open decisions

Listed so they can be answered in the planning chat rather than guessed silently.

1. **Language.** Default assumption: Python for the whole program, because crawling, documents, email and browser automation are all mature there. The alternative, TypeScript, is better if the author wants one language with a browser-based page, at the cost of weaker document and email tooling.
2. **Claude Code, Codex, or both.** Default assumption: both, one primary and one fallback behind the same shapes, so a usage limit does not stop the model stages. The alternative, one engine only, is simpler but loses the fallback.
3. **How far automatic applying goes.** Default assumption: official boards only, staged first, promoted by clean dry runs. The alternative, staged-only for everything, is safest and removes the hardest engineering; the alternative of automating more boards adds fragile adapters.
4. **Big platforms.** Default assumption: discovery by alert email and assisted manual submit only. The alternative, automating them, risks the user's account on the platforms where their profile matters most.
5. **How much the model may write.** Default assumption: it proposes wordings from a point's own terms, the claim check runs, and the user approves each before it is ever used. The alternative, no model-proposed text at all (only the user's own alternate wordings), is the most trustworthy and the least adaptive.
6. **Approval policy.** Default assumption: approve every application at first, with per-board promotion to automatic after a set number of clean runs. The alternative, approve every application forever, is safest but caps how hands-off it can get.
7. **Where the profile, sessions and evidence live.** Default assumption: a folder in the user's home, encrypted by the disk, with sessions excluded from backups and the profile and evidence included. The alternative, a separate encrypted volume, is safer and more effort.
8. **Where it runs.** Default assumption: the author's laptop while awake, with a heartbeat for missed runs. The alternative, a spare always-on machine, gives true continuous running.
9. **Scoring approach.** Default assumption: rules and keywords first, then the model on a shortlist, calibrated against the labelled set. The alternative, adding a learned ranker once enough outcomes exist, is deferred.
10. **Resume compile.** Default assumption: Scout compiles with a local LaTeX installation and checks the page count itself. The alternative, producing source only and letting the user compile elsewhere, removes the dependency but loses the one-page proof.
11. **Testing style.** Default assumption: saved boards and forms, a fake model with recordings, property checks, and a manual smoke procedure against real sites. The alternative, testing against live sites in automated runs, is flaky and may breach their rules.

---

## 10. Glossary

- **Scout**: the pipeline described here. **Pipeline**: the loop know the candidate, find, filter, score, build the resume, apply, track.
- **Profile**: the structured record of the user's facts, points and preferences. **Point**: one experience or project statement, stored once. **Status**: how sure a point is (confirmed, from code, ask first, hold, excluded). **Terms**: the technologies a point may truthfully use. **Alternate wording**: an approved rewording of a point, used when a job mentions its trigger terms. **Pending**: a proposed change waiting for the user. **Never used list**: items kept out of every resume. **Answer bank**: approved answers to recurring form questions. **Profile version**: a number that changes whenever the profile does.
- **Verified note**: a written, checked understanding of one repository, made once. **Do-not-claim list**: what a note says must not be claimed.
- **Resume builder**: the step that turns the profile and a job's keywords into a one-page resume. **Template**: the fixed layout. **Stretchable gaps**: spacing that shares out spare room so any amount of content fills one page. **Page-fit estimate**: a quick guess of how full the page is (not the fit rating). **Compile**: turning the resume source into a PDF. **Selection**: choosing which points to show for a job. **Keyword wording**: choosing an alternate wording that matches the job's terms. **Not in your profile**: job keywords the profile does not hold and Scout therefore never adds. **Fit rating**: the closing score out of 10 for a resume against a job.
- **Machine-readable resume**: single column, standard headings, contact details in the body, no tables or images, plain text PDF. **Knockout question**: a required form question whose wrong answer rejects an application automatically.
- **Source**: where a job came from. **Official job board**: a company's own list of openings, run by an applicant-tracking system. **Applicant-tracking system (ATS)**: employer software that publishes jobs and receives applications. **Aggregator**: a site that collects jobs from many employers. **Alert email**: a message from a job platform listing new matches.
- **Posting**: one published job. **Job record**: Scout's normalized copy of a posting. **Canonical link**: the one true apply address for a job. **Job folder**: everything about one job in one place. **Board table**: the generated list of every job and its status. **Lead**: a job found but not yet pursued.
- **Dedupe**: merging records that describe the same job. **Repost**: the same job published again. **Freshness**: how recently a job appeared. **Closed job**: a posting no longer accepting applications. **Ghost job**: a posting with no real intention to hire, guessed from signals. **Scam signal**: a sign a posting is fraudulent.
- **Hard rule**: a filter that drops a job outright (location, salary, seniority, exclusions). **Keyword ranking**: ordering by word overlap with the profile's terms, with no model.
- **Eligibility**: whether the user could plausibly and legally get the job. **Desirability**: whether the user wants it. **Must-have / nice-to-have**: requirements the posting insists on or only prefers. **Red flag**: a warning sign in a job or company. **Confidence band**: the range of certainty that decides shortlist, review or skip. **Cooldown**: the wait before applying again to the same company. **Tier**: a source's trust rank, A (best) to E.
- **Shortlist**: jobs worth the user's attention today. **Digest**: the daily view of cards. **Card**: one job with its score, reasons and prepared material. **Skip tag**: the reason the user gives for rejecting a card. **Needs you**: a block or state meaning a human must act (a code, a login, a decision). **Settings**: the view of choices about how Scout behaves.
- **Verifier / claim check**: the check that every claim in generated text is supported by the profile. **Claim**: any statement of fact in generated text.
- **Application**: one submission for one job. **Evidence**: the saved files, screenshot and confirmation that prove an application. **Form snapshot**: the saved list of a form's fields. **Two-pass fill**: filling, then reading back and comparing. **Dry run**: doing everything except the final submit. **Staged**: prepared but left for the user to submit.
- **Level (0, 1, 2)**: how much Scout does on a given site: staged, filled with the user submitting, or automatic. **Promotion**: moving a site up a level after a clean record. **Apply mode**: the setting for when Scout applies.
- **Adapter**: the small isolated part that knows one job board's form. **Self-test**: a daily dry run of an adapter on a stable public posting. **Repair**: a proposed fix to a broken adapter, applied only after the user approves it.
- **Question class**: factual, personal, motivational, legal, demographic or salary.
- **State machine**: the fixed list of states a job moves through (found, shortlisted, resume-ready, approved, submitting, applied, contacted, interviewing, offer, rejected, and the side states skipped, needs-you, unverified, failed, closed, withdrawn). **Idempotent**: safe to repeat without double effect. **Submitting state**: the marker set before the final click so a crash cannot cause a second submit.
- **Brain**: Claude Code or Codex, used for language work only. **Budget**: the cap on model calls per day. **Batching**: many items in one request. **Cache**: stored results reused for the same input. **Degraded mode**: running without the model. **Usage limit**: the subscription's cap on use, with a reset time. **Structured output**: a reply that must match a fixed shape.
- **Untrusted text / prompt injection**: text from outside (a posting, a page, an email) that may try to give the model instructions; Scout treats it as data only.
- **Labelled set**: jobs hand-labelled by the user (apply, maybe, skip) for measuring the scorer. **Precision / recall**: how many chosen jobs were right, and how many right jobs were chosen. **Calibration**: checking that scores agree with what the user actually decides. **Shadow mode**: running a new setup beside the old to compare. **Replay**: rescoring past jobs with current instructions.
- **Fake model**: a stand-in that replies from recordings for tests. **Saved-form set**: stored copies of real forms for tests. **Property check**: a test that asserts a rule holds rather than an exact output. **Smoke check**: a short manual run against real sites.
- **Funnel**: discovered, shortlisted, applied, replied, interviewing, offered. **Follow-up**: a polite message after no reply. **Interview preparation**: a plan built from the saved job description and the resume sent.
- **Session**: a saved signed-in browser state. **Dedicated profile**: a browser profile used only by Scout. **Assisted apply**: Scout prepares, the user submits.
- **Kill switch**: one control that stops all automatic action. **Heartbeat**: a periodic signal that Scout is alive. **Status area**: the part of the page showing health and today's activity.
