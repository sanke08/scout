import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { loadFixtureMessage, makeFakeConnection } from "../../fixtures/mail/builders.js";
import { createMailboxReader, type MailConnection } from "./mailbox-reader.js";
import { MAX_SOURCE_BYTES, MAX_TEXT_CHARACTERS, parseRawMessage } from "./parse-message.js";

describe("parseRawMessage", () => {
  it("reads sender, subject, date and text from a saved email", async () => {
    const message = await loadFixtureMessage("interview-invite");
    expect(message.fromAddress).toBe("talent@harbor-systems.example.com");
    expect(message.fromName).toBe("Harbor Systems Talent");
    expect(message.subject).toContain("Backend Engineer interview");
    expect(message.date).toBe("2026-11-03T09:00:00.000Z");
    expect(message.id).toBe("<invite-001@harbor-systems.example.com>");
    expect(message.text).toContain("schedule an interview");
  });

  it("turns HTML-only mail into text without markup, scripts or styles", async () => {
    const message = await loadFixtureMessage("html-only-rejection");
    expect(message.text).toContain("not selected");
    expect(message.text).not.toMatch(/<[a-z]/i);
    expect(message.text).not.toContain("alert(");
    expect(message.text).not.toContain("color: red");
  });

  it("cuts very long text and says so", async () => {
    const raw = `From: a@example.com\r\nSubject: long\r\nContent-Type: text/plain\r\n\r\n${"word ".repeat(30_000)}`;
    const message = await parseRawMessage(raw, "long-1");
    expect(message.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARACTERS);
    expect(message.truncated).toBe(true);
  });

  it("refuses a source over the size cap with an invalid-input error", async () => {
    const huge = Buffer.alloc(MAX_SOURCE_BYTES + 1, "a");
    await expect(parseRawMessage(huge, "huge-1")).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  it("uses the fallback id when the message has no id header", async () => {
    const message = await parseRawMessage(
      "From: a@example.com\r\nSubject: hi\r\n\r\nhello",
      "uid-9",
    );
    expect(message.id).toBe("uid-9");
    expect(message.date).toBeUndefined();
  });
});

describe("createMailboxReader", () => {
  it("returns parsed messages from the connection and closes it", async () => {
    const { connection, log } = makeFakeConnection(["received", "rejection"]);
    const reader = createMailboxReader({ connect: async () => connection });
    const result = await reader.readSince("INBOX", new Date("2026-11-01T00:00:00.000Z"));
    expect(result.messages.map((message) => message.subject)).toEqual([
      "We received your application for Backend Engineer",
      "Update on your application to Northwind Labs",
    ]);
    expect(result.skipped).toEqual([]);
    expect(log.operations.at(-1)).toBe("close");
  });

  it("only ever lists, fetches and closes (read-only by construction)", async () => {
    const { connection, log } = makeFakeConnection(["offer", "recruiter"]);
    await createMailboxReader({ connect: async () => connection }).readSince("INBOX", new Date(0));
    for (const operation of log.operations) {
      expect(operation).toMatch(/^(list|fetch|close)\b/);
    }
    expect(Object.keys(connection).sort()).toEqual(["close", "fetchSource", "listMessageIds"]);
  });

  it("skips an oversize message, reports it, and still reads the others", async () => {
    const { connection } = makeFakeConnection(["offer"], {
      "too-big": Buffer.alloc(MAX_SOURCE_BYTES + 100, "a"),
    });
    const result = await createMailboxReader({ connect: async () => connection }).readSince(
      "INBOX",
      new Date(0),
    );
    expect(result.messages).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.messageId).toBe("too-big");
    expect(result.skipped[0]?.reason).toMatch(/skipped/);
  });

  it("reads only the newest messages when there are more than the limit", async () => {
    const { connection } = makeFakeConnection(["received", "rejection", "offer"]);
    const result = await createMailboxReader({ connect: async () => connection }).readSince(
      "INBOX",
      new Date(0),
      2,
    );
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]?.subject).toBe("Your offer from Harbor Systems");
  });

  it("closes the connection even when listing fails", async () => {
    let closed = false;
    const broken: MailConnection = {
      async listMessageIds() {
        throw new ScoutError("unavailable", "The mail server did not answer.");
      },
      async fetchSource() {
        return Buffer.alloc(0);
      },
      async close() {
        closed = true;
      },
    };
    const reader = createMailboxReader({ connect: async () => broken });
    await expect(reader.readSince("INBOX", new Date(0))).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(closed).toBe(true);
  });

  it("rejects a limit that is not a positive whole number", async () => {
    const { connection } = makeFakeConnection([]);
    const reader = createMailboxReader({ connect: async () => connection });
    await expect(reader.readSince("INBOX", new Date(0), 0)).rejects.toMatchObject({
      code: "invalid-input",
    });
  });
});
