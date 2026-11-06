/**
 * Runs the whole reply-tracking pipeline over a batch of messages: classify, match, apply.
 *
 * Why it exists: it is the one function the command line calls after reading the mailbox. It
 * keeps the safety properties in one place: message text never decides anything beyond a label,
 * only matched messages can change a job, and every change goes through the store's state machine.
 *
 * Example: `await trackMessages({ messages, jobStore, now })` returns one `TrackedMessage` per
 * message saying what it was, which job it matched and whether the status changed.
 */
import type { ActionLog, Brain, JobStore } from "../shared/index.js";
import { applyOutcome, type OutcomeResult } from "./apply-outcome.js";
import { classifyMessage } from "./classify-message.js";
import { classifyWithBrain } from "./classify-with-brain.js";
import { matchMessageToJob, type MatchResult } from "./match-message.js";
import type { Classification, ParsedMessage } from "./message-types.js";

/** What happened to one message. */
export interface TrackedMessage {
  messageId: string;
  classification: Classification;
  match: MatchResult;
  /** Present only when the message was matched to a job and could move its status. */
  outcome?: OutcomeResult;
}

/** What `trackMessages` needs. */
export interface TrackMessagesOptions {
  messages: ParsedMessage[];
  jobStore: JobStore;
  /** Optional. Only messages the rules call ambiguous are sent to it. */
  brain?: Brain;
  /** Optional. When given, each status change is also written to the action log. */
  actionLog?: ActionLog;
}

/**
 * Handles each message in turn. Messages the rules label `other` or `ambiguous` (and the model
 * could not settle) are never applied. Unmatched messages are reported and change nothing.
 *
 * The action log gets the kind and the job id, never the message text.
 */
export async function trackMessages(options: TrackMessagesOptions): Promise<TrackedMessage[]> {
  const tracked: TrackedMessage[] = [];
  for (const message of options.messages) {
    const classification =
      options.brain === undefined
        ? classifyMessage(message)
        : await classifyWithBrain(options.brain, message);
    const match = matchMessageToJob(message, options.jobStore.list());
    const entry: TrackedMessage = { messageId: message.id, classification, match };

    if (match.kind === "matched" && classification.kind !== "ambiguous") {
      entry.outcome = applyOutcome(
        options.jobStore,
        match.jobId,
        classification.kind,
        `Email classified as ${classification.kind}.`,
      );
      if (entry.outcome.changed) {
        options.actionLog?.append({
          actor: "tracking",
          action: "reply-applied",
          jobId: match.jobId,
          detail: `A ${classification.kind} email moved the job from ${entry.outcome.from} to ${entry.outcome.to}.`,
        });
      }
    }
    tracked.push(entry);
  }
  return tracked;
}
