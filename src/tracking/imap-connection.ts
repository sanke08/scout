/**
 * The real mailbox connection, made with imapflow over TLS.
 *
 * Why it exists: it is the only code in Scout that talks to a mail server. It is deliberately
 * tiny: it opens a folder read-only (the server is told "examine", so no flag can change), lists
 * message numbers since a date and fetches raw source. It never stores, moves, deletes or marks
 * anything.
 *
 * The credentials come from the caller, who reads them from the system's secure store. This file
 * never reads them from a file or the environment and never logs them. Errors from the server are
 * replaced by a fixed message so no server text (which can contain account names) is repeated.
 *
 * NOT TESTED against a real mail server: the unit tests use a fake `MailConnection`.
 *
 * Example: `createImapConnector({ host: "imap.example.com", user: "alex@example.com", password })`.
 */
import { ImapFlow } from "imapflow";
import { ScoutError } from "../shared/index.js";
import type { ConnectToMailbox, MailConnection } from "./mailbox-reader.js";

/** What the caller must supply to log in. Never written to disk or logs by Scout. */
export interface ImapCredentials {
  host: string;
  /** Defaults to 993, the standard port for IMAP over TLS. */
  port?: number;
  user: string;
  /** An app password from the system's secure store. */
  password: string;
}

/** The one message shown for any server failure. It names no server text and no secret. */
const UNAVAILABLE_MESSAGE =
  "Scout could not read the mailbox. Check the mail server address, the account name and the app password, then try again.";

/** Wraps any failure from the mail library in a `ScoutError` that repeats nothing from the server. */
function unavailable(): ScoutError {
  return new ScoutError("unavailable", UNAVAILABLE_MESSAGE);
}

/**
 * Returns a function that opens a read-only TLS connection with these credentials.
 *
 * Failure: the returned function throws `ScoutError("unavailable")` when login or connection fails.
 */
export function createImapConnector(credentials: ImapCredentials): ConnectToMailbox {
  return async () => {
    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port ?? 993,
      secure: true,
      auth: { user: credentials.user, pass: credentials.password },
      logger: false,
    });
    try {
      await client.connect();
    } catch {
      throw unavailable();
    }

    const connection: MailConnection = {
      async listMessageIds(folder, since) {
        try {
          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const found = await client.search({ since }, { uid: true });
            return (found === false || found === undefined ? [] : found).map(String);
          } finally {
            lock.release();
          }
        } catch {
          throw unavailable();
        }
      },
      async fetchSource(folder, messageId, maxBytes) {
        try {
          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const message = await client.fetchOne(
              messageId,
              { source: { start: 0, maxLength: maxBytes + 1 } },
              { uid: true },
            );
            if (message === false || message.source === undefined) {
              throw unavailable();
            }
            return message.source;
          } finally {
            lock.release();
          }
        } catch {
          throw unavailable();
        }
      },
      async close() {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      },
    };
    return connection;
  };
}
