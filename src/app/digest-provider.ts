/**
 * Builds the Digest cards: one per shortlisted job, with its score, reasons and a resume built
 * for that job.
 *
 * Why it exists: the web module only shows cards; something must turn stored jobs, stored scores
 * and the resume builder into `DigestCard` values. The resume is built with the job's own skill
 * list as keywords, and the builder only ever uses wording the profile already holds, so the
 * preview never contains a skill the user does not have.
 *
 * Example: `createDigestProvider(application)()` returns `[{ job, shortlistScore: 82, reasons, unmet: [],
 * answers: [], resumePreview: "Alex Rivera\n..." }]`.
 */
import { keywordScore } from "../decide/index.js";
import type { DigestCard, DigestProvider, PendingProposal } from "../web/index.js";
import type { JobRecord, Profile, ResumeBuild } from "../shared/index.js";
import type { Application } from "./application.js";
import { latexToText } from "./latex-to-text.js";

/**
 * The text shown in a card's details: the resume as plain text, then what the builder left out.
 * Example: "Alex Rivera ...\n\nNot in your profile, so not added: Kubernetes".
 */
export function describeResume(build: ResumeBuild): string {
  const parts = [latexToText(build.texSource)];
  if (build.notInProfile.length > 0) {
    parts.push(`Not in your profile, so not added: ${build.notInProfile.join(", ")}`);
  }
  return parts.join("\n\n");
}

/** Builds the card for one shortlisted job. */
function buildCard(application: Application, profile: Profile, job: JobRecord): DigestCard {
  const score = application.scoreStore.find(job.id, profile.version);
  const build = application.resumeBuilder.build(profile, job.skills, { company: job.company });
  const fallbackReason = job.statusReason ?? "Shortlisted.";
  return {
    job,
    shortlistScore: score?.shortlistScore ?? keywordScore(job, profile),
    reasons: score?.reasons ?? [fallbackReason],
    unmet: score?.unmet ?? [],
    answers: [],
    resumePreview: describeResume(build),
  };
}

/**
 * Creates the provider the web server calls for each Digest request. The best score comes first.
 * Failure: no profile gives `ScoutError("not-found")` from the profile store, which the server
 * turns into a clear error reply.
 */
export function createDigestProvider(application: Application): DigestProvider {
  return () => {
    const profile = application.profileStore.load();
    const cards = application.jobStore
      .list({ status: "shortlisted" })
      .map((job) => buildCard(application, profile, job));
    return cards.sort((first, second) => second.shortlistScore - first.shortlistScore);
  };
}

/**
 * The pending model proposals as the Profile view shows them: "Harbor Systems, point 2" and the text.
 * Returns an empty list when there are none or no profile exists yet.
 */
export function createPendingProposals(application: Application): () => PendingProposal[] {
  return () => {
    if (!application.profileStore.exists()) return [];
    const profile = application.profileStore.load();
    return application.proposalStore.list().map((proposal) => {
      const entry = profile[proposal.target.section][proposal.target.entryIndex];
      const name =
        entry === undefined ? "a removed entry" : "org" in entry ? entry.org : entry.title;
      return {
        target: `${name}, point ${proposal.target.pointIndex + 1}`,
        text: proposal.text,
      };
    });
  };
}
