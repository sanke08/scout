/**
 * Public surface of the tracking module. Other modules import only from here.
 *
 * - Reading mail (read-only): `createMailboxReader`, `createImapConnector`, `parseRawMessage`.
 * - Understanding mail: `classifyMessage`, `classifyWithBrain`, `matchMessageToJob`,
 *   `applyOutcome`, `trackMessages`.
 * - Follow-ups: `draftFollowUp`, `isFollowUpDue`.
 * - Platform alerts: `parseAlertEmail`, `resolveToOfficialBoard`, `pickMatchingPosting`.
 * - Funnel: `buildFunnel`.
 * - Recruiter contacts: `buildRecruiterContact` and its helpers.
 */
export { createMailboxReader } from "./mailbox-reader.js";
export type {
  ConnectToMailbox,
  MailboxReadResult,
  MailboxReader,
  MailboxReaderOptions,
  MailConnection,
  SkippedMessage,
} from "./mailbox-reader.js";
export { createImapConnector, type ImapCredentials } from "./imap-connection.js";
export {
  MAX_SOURCE_BYTES,
  MAX_SUBJECT_CHARACTERS,
  MAX_TEXT_CHARACTERS,
  parseRawMessage,
  senderDomain,
} from "./parse-message.js";
export {
  DECIDED_MESSAGE_KINDS,
  MESSAGE_KINDS,
  modelClassificationSchema,
  type Classification,
  type MessageKind,
  type ModelClassification,
  type ParsedMessage,
} from "./message-types.js";
export { AMBIGUOUS_BELOW_CONFIDENCE, classifyMessage } from "./classify-message.js";
export { CLASSIFY_TASK, classifyWithBrain } from "./classify-with-brain.js";
export {
  MINIMUM_LEAD,
  MINIMUM_SCORE,
  REPLYABLE_STATUSES,
  matchMessageToJob,
  type MatchCandidate,
  type MatchResult,
} from "./match-message.js";
export { applyOutcome, type OutcomeResult } from "./apply-outcome.js";
export { trackMessages, type TrackMessagesOptions, type TrackedMessage } from "./track-messages.js";
export {
  CONNECTION_NOTE_LIMIT,
  daysWithoutReply,
  draftFollowUp,
  isFollowUpDue,
  type FollowUpDraft,
} from "./follow-up.js";
export {
  ALERT_PLATFORMS,
  MAX_JOBS_PER_ALERT,
  detectAlertPlatform,
  parseAlertEmail,
  type AlertPlatform,
  type PartialPosting,
} from "./alert-parsers.js";
export {
  pickMatchingPosting,
  resolveToOfficialBoard,
  type BoardLookup,
  type BoardResolution,
} from "./resolve-board.js";
export {
  AGE_BUCKETS,
  ageBucketOf,
  buildFunnel,
  type AgeBucket,
  type AgeCounts,
  type Funnel,
  type FunnelCounts,
} from "./funnel.js";
export {
  buildRecruiterContact,
  chooseContactAddress,
  guessEmail,
  isEmailAddress,
  pickHiringInbox,
  pickProfileUrl,
  pickPublishedEmail,
  type ContactAddressBasis,
  type GuessedEmail,
  type PublishedEmail,
  type RecruiterContact,
  type RecruiterLookupInput,
  type SearchResult,
} from "./recruiter-contact.js";
