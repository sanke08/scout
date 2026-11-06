/**
 * The public types of the web module: what the server needs from the outside world and what it
 * hands back. Everything the server touches is injected, so tests pass fakes and the real
 * program passes the real stores.
 */
import type {
  JobRecord,
  JobStore,
  ProfileStore,
  ResumeBuilder,
  SettingsStore,
} from "../shared/index.js";

/** One question Scout will answer on a form, and the answer it will give. */
export interface DigestAnswer {
  /** The form question, e.g. "Notice period". */
  question: string;
  /** The approved answer, e.g. "30 days". */
  answer: string;
}

/**
 * One card of the Digest: a shortlisted job with everything the user needs to approve or skip it.
 * Example: `{ job, shortlistScore: 88, reasons: ["Matches Node.js"], unmet: [], answers: [],
 * resumePreview: "Alex Rivera ..." }`.
 */
export interface DigestCard {
  /** The stored job. Its `status` tells the page whether the card is still waiting. */
  job: JobRecord;
  /** Combined shortlist score, 0 to 100. */
  shortlistScore: number;
  /** Fit rating of the finished resume, 0 to 10. Absent when no model was available to rate it. */
  fitRating?: number;
  /** Short plain-words reasons the job was shortlisted. */
  reasons: string[];
  /** Requirements of the posting that the profile does not meet. */
  unmet: string[];
  /** The answers that will be sent with the application. */
  answers: DigestAnswer[];
  /** The resume as plain text, for the card's details. */
  resumePreview: string;
}

/**
 * Supplies the cards of today's Digest. The real one is wired later; tests use fakes. A failure
 * (thrown error or rejected promise) turns into a clear 500 reply and a log line.
 */
export type DigestProvider = () => DigestCard[] | Promise<DigestCard[]>;

/** A model-written wording waiting for the user's approval. Shown read-only on the Profile view. */
export interface PendingProposal {
  /** What the proposal is about, e.g. "Team Chat, point 2". */
  target: string;
  /** The proposed text. It changes nothing until the user approves it elsewhere. */
  text: string;
}

/** Everything the server needs from the rest of Scout. */
export interface WebDependencies {
  profileStore: ProfileStore;
  settingsStore: SettingsStore;
  jobStore: JobStore;
  resumeBuilder: ResumeBuilder;
  digestProvider: DigestProvider;
  /** Pending model proposals to show on the Profile view. Left out when there are none. */
  pendingProposals?: () => PendingProposal[];
  /** The clock; tests inject a fixed one. Defaults to the real time. */
  now?: () => Date;
}

/** How to run the server. */
export interface WebServerOptions {
  /** Port to listen on; 0 lets the system choose a free one (used by tests). */
  port?: number;
}

/** A running server. */
export interface RunningWebServer {
  /** The address to open, e.g. `http://127.0.0.1:4173`. */
  url: string;
  /** Stops listening and ends open connections. */
  close(): Promise<void>;
}
