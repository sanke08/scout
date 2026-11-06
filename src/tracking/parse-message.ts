/**
 * Turns the raw source of one email into a `ParsedMessage`, with size limits.
 *
 * Why it exists: a mailbox holds hostile and enormous messages. This is the one place raw email
 * is read, so the limits live here and nothing else ever sees raw source.
 *
 * Example: `await parseRawMessage(rawBytes, "uid-42")` gives a `ParsedMessage` whose text is at
 * most `MAX_TEXT_CHARACTERS` long. A source over `MAX_SOURCE_BYTES` is refused.
 */
import { simpleParser } from "mailparser";
import { ScoutError } from "../shared/index.js";
import { emailHtmlToText } from "./html-to-text.js";
import type { ParsedMessage } from "./message-types.js";

/** Largest raw email Scout will read (5 MiB). Bigger ones are skipped and reported, never read. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/** Longest text kept per message. Longer text is cut and `truncated` is set. */
export const MAX_TEXT_CHARACTERS = 50_000;

/** Longest subject kept. Hostile messages can carry very long subjects. */
export const MAX_SUBJECT_CHARACTERS = 300;

/** Longest sender display name kept. */
const MAX_NAME_CHARACTERS = 200;

/**
 * Parses one raw email. Attachments are ignored; only the sender, subject, date and text are kept.
 *
 * `fallbackId` is used when the message has no id header, for example the mailbox's own number for
 * it, so the caller can still remember that it handled this message.
 *
 * Failure: throws `ScoutError("invalid-input")` when the source is larger than `MAX_SOURCE_BYTES`
 * or cannot be parsed at all.
 */
export async function parseRawMessage(
  raw: Buffer | string,
  fallbackId: string,
): Promise<ParsedMessage> {
  const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
  if (size > MAX_SOURCE_BYTES) {
    throw new ScoutError(
      "invalid-input",
      `The message ${fallbackId} is larger than ${MAX_SOURCE_BYTES} bytes, so Scout skipped it without reading it.`,
    );
  }
  let parsed;
  try {
    parsed = await simpleParser(raw, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
      skipTextLinks: true,
    });
  } catch {
    throw new ScoutError(
      "invalid-input",
      `The message ${fallbackId} could not be read as an email, so Scout skipped it.`,
    );
  }

  const sender = parsed.from?.value[0];
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const plain = (parsed.text ?? "").trim();
  const fullText = plain !== "" ? plain : emailHtmlToText(html);
  const truncated = fullText.length > MAX_TEXT_CHARACTERS;

  const message: ParsedMessage = {
    id: parsed.messageId ?? fallbackId,
    fromName: (sender?.name ?? "").slice(0, MAX_NAME_CHARACTERS),
    fromAddress: (sender?.address ?? "").toLowerCase(),
    subject: (parsed.subject ?? "").slice(0, MAX_SUBJECT_CHARACTERS),
    text: fullText.slice(0, MAX_TEXT_CHARACTERS),
    truncated,
  };
  if (parsed.date !== undefined && !Number.isNaN(parsed.date.getTime())) {
    message.date = parsed.date.toISOString();
  }
  return message;
}

/**
 * Returns the part of the sender address after the `@`, lower case, or an empty string.
 *
 * Example: `senderDomain(message)` is "mail.harbor-systems.example.com" for
 * "talent@mail.harbor-systems.example.com".
 */
export function senderDomain(message: ParsedMessage): string {
  const at = message.fromAddress.lastIndexOf("@");
  return at === -1 ? "" : message.fromAddress.slice(at + 1);
}
