/**
 * Read-only access to the user's mailbox, behind a small injectable connection.
 *
 * Why it exists: tracking needs recent mail, but Scout must never send, delete, move or mark
 * mail as read. The reader only ever asks the connection for two things: which messages arrived
 * since a date, and the raw source of one of them. There is no method for anything else, so
 * nothing else can happen. Tests give the reader a fake connection that serves saved `.eml` files.
 *
 * Example:
 * `const reader = createMailboxReader({ connect: createImapConnector(credentials) });`
 * `const { messages } = await reader.readSince("INBOX", new Date("2026-11-01"));`
 */
import { ScoutError } from "../shared/index.js";
import type { ParsedMessage } from "./message-types.js";
import { MAX_SOURCE_BYTES, parseRawMessage } from "./parse-message.js";

/**
 * The only mailbox operations Scout can perform. Both are read-only by construction: the real
 * implementation opens the folder read-only and fetches without touching any flag.
 */
export interface MailConnection {
  /** Returns the ids (the mailbox's own numbers) of messages that arrived on or after `since`. */
  listMessageIds(folder: string, since: Date): Promise<string[]>;
  /**
   * Returns the raw source of one message, at most `maxBytes + 1` bytes of it (so a caller can
   * tell "too big" from "just fits" without downloading a huge message).
   */
  fetchSource(folder: string, messageId: string, maxBytes: number): Promise<Buffer>;
  /** Ends the connection. Called once, even when reading failed. */
  close(): Promise<void>;
}

/** Opens a connection. Real code passes `createImapConnector(credentials)`; tests pass a fake. */
export type ConnectToMailbox = () => Promise<MailConnection>;

/** Options for `createMailboxReader`. */
export interface MailboxReaderOptions {
  connect: ConnectToMailbox;
}

/** One message the reader could not use, and why, so the user can see what was skipped. */
export interface SkippedMessage {
  messageId: string;
  /** A full-sentence reason. */
  reason: string;
}

/** What `readSince` returns: the readable messages (oldest first) and the skipped ones. */
export interface MailboxReadResult {
  messages: ParsedMessage[];
  skipped: SkippedMessage[];
}

/** A reader of recent mail. */
export interface MailboxReader {
  /**
   * Reads up to `limit` of the newest messages in `folder` that arrived on or after `since`.
   * Too-large or unreadable messages are skipped and listed; one bad message never stops the rest.
   * Failure: throws what the connection throws (a `ScoutError("unavailable")` for the real one).
   */
  readSince(folder: string, since: Date, limit?: number): Promise<MailboxReadResult>;
}

/** The most messages one `readSince` call reads when no limit is given. */
export const DEFAULT_MESSAGE_LIMIT = 200;

/**
 * Creates a mailbox reader. A fresh connection is opened for every `readSince` call and always
 * closed afterwards.
 */
export function createMailboxReader(options: MailboxReaderOptions): MailboxReader {
  return {
    async readSince(folder, since, limit = DEFAULT_MESSAGE_LIMIT) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new ScoutError(
          "invalid-input",
          "The message limit must be a whole number of 1 or more.",
        );
      }
      const connection = await options.connect();
      try {
        const allIds = await connection.listMessageIds(folder, since);
        const newestIds = allIds.slice(-limit);
        const messages: ParsedMessage[] = [];
        const skipped: SkippedMessage[] = [];
        for (const messageId of newestIds) {
          try {
            const source = await connection.fetchSource(folder, messageId, MAX_SOURCE_BYTES);
            messages.push(await parseRawMessage(source, messageId));
          } catch (error) {
            if (error instanceof ScoutError && error.code === "invalid-input") {
              skipped.push({ messageId, reason: error.message });
            } else {
              throw error;
            }
          }
        }
        return { messages, skipped };
      } finally {
        await connection.close();
      }
    },
  };
}
