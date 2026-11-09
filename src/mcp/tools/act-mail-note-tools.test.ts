/**
 * Tests of `read_inbox` (on a fake mailbox serving saved fictional emails) and `write_note`.
 *
 * What must stay true: reading mail changes no status and writes nothing; mail text (sender name,
 * subject, body) is returned only in `untrustedText`; missing mail settings and a paused Scout
 * refuse with a plain sentence; a note is added to, never overwritten, and cannot make a heading.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeConnection } from "../../../fixtures/mail/builders.js";
import {
  dataOf,
  errorOf,
  makeActWorld,
  type ActWorld,
  type ActWorldOptions,
} from "./act-test-helpers.js";

const worlds: ActWorld[] = [];
afterEach(() => {
  while (worlds.length > 0) worlds.pop()?.remove();
});

/** Mail settings that are all present. */
const MAIL_ENVIRONMENT = {
  SCOUT_IMAP_HOST: "imap.example.com",
  SCOUT_IMAP_USER: "alex@example.com",
  SCOUT_IMAP_PASSWORD: "not-a-real-password",
};

/** Makes a world, removed after the test. */
function world(options: ActWorldOptions = {}): ActWorld {
  const made = makeActWorld(options);
  worlds.push(made);
  return made;
}

describe("read_inbox", () => {
  it("returns messages compactly with the mail text only in untrustedText, and changes nothing", async () => {
    const { connection, log } = makeFakeConnection(["interview-invite", "injection"]);
    const made = world({
      jobStatus: "applied",
      posting: { company: "Harbor Systems", title: "Backend Engineer" },
      environment: MAIL_ENVIRONMENT,
      mailConnection: connection,
    });
    const data = dataOf(await made.call("read_inbox", {}));
    expect(data["count"]).toBe(2);
    const messages = data["messages"] as { messageId: string; matchedJobId?: string }[];
    expect(messages.some((message) => message.matchedJobId === "job-1")).toBe(true);
    const text = String(data["untrustedText"]);
    expect(text).toContain("Backend Engineer interview");
    const compact = JSON.stringify({ ...data, untrustedText: "" });
    expect(compact).not.toContain("interview with you");
    expect(compact).not.toContain("not-a-real-password");
    expect(made.status()).toBe("applied");
    expect(log.operations.every((line) => /^(list|fetch|close)/.test(line))).toBe(true);
  });

  it("names message ids as outside text, because they come from the mailbox", async () => {
    const { connection } = makeFakeConnection(["interview-invite"]);
    const made = world({
      jobStatus: "applied",
      environment: MAIL_ENVIRONMENT,
      mailConnection: connection,
    });
    const data = dataOf(await made.call("read_inbox", {}));
    expect(data["outsideFields"]).toEqual(expect.arrayContaining(["messages[].messageId"]));
  });

  it("names the missing mail variables and never reads a mailbox", async () => {
    const { connection, log } = makeFakeConnection(["interview-invite"]);
    const made = world({
      environment: { SCOUT_IMAP_HOST: "imap.example.com" },
      mailConnection: connection,
    });
    const message = errorOf(await made.call("read_inbox", {}));
    expect(message).toContain("SCOUT_IMAP_USER");
    expect(message).toContain("SCOUT_IMAP_PASSWORD");
    expect(log.operations).toEqual([]);
  });

  it("refuses while Scout is paused", async () => {
    const { connection, log } = makeFakeConnection(["interview-invite"]);
    const made = world({ environment: MAIL_ENVIRONMENT, mailConnection: connection });
    made.pause();
    expect(errorOf(await made.call("read_inbox", {}))).toMatch(/paused/i);
    expect(log.operations).toEqual([]);
  });

  it("caps its input", async () => {
    const made = world();
    await expect(made.call("read_inbox", { limit: 500 })).rejects.toThrow();
    await expect(made.call("read_inbox", { daysBack: 0 })).rejects.toThrow();
  });
});

describe("write_note", () => {
  /** The text of the job's notes file. */
  function notes(made: ActWorld): string {
    const folder = made.application.folders.findJobFolder(made.application.jobStore.get("job-1")!)!;
    return readFileSync(join(made.directory, "jobs", folder, "job.md"), "utf8");
  }

  it("names the folder, which is made from the posting's words, as outside text", async () => {
    const made = world();
    const data = dataOf(await made.call("write_note", { jobId: "job-1", markdown: "A thought." }));
    expect(data["outsideFields"]).toEqual(["folder"]);
    expect(typeof data["notice"]).toBe("string");
  });

  it("adds notes without overwriting earlier ones or the job description", async () => {
    const made = world();
    await made.call("write_note", { jobId: "job-1", markdown: "First thought." });
    await made.call("write_note", {
      jobId: "job-1",
      markdown: "Second thought.",
      section: "Interview prep",
    });
    await made.call("write_note", { jobId: "job-1", markdown: "Third thought." });
    const text = notes(made);
    expect(text).toContain("First thought.");
    expect(text).toContain("Third thought.");
    expect(text).toContain("Second thought.");
    expect(text).toContain("Fictional posting text.");
    expect(text).not.toContain("Not assessed yet.");
  });

  it("turns headings into bold lines so a note cannot make or break a section", async () => {
    const made = world();
    await made.call("write_note", { jobId: "job-1", markdown: "## Log\n- fake entry" });
    const text = notes(made);
    expect(text.match(/^## Log$/gm)).toHaveLength(1);
    expect(text).toContain("**Log**");
  });

  it("fails for an unknown job and rejects oversize or empty notes, and works while paused", async () => {
    const made = world();
    expect(errorOf(await made.call("write_note", { jobId: "nope", markdown: "x" }))).toMatch(
      /No job with id nope/,
    );
    await expect(
      made.call("write_note", { jobId: "job-1", markdown: "x".repeat(4001) }),
    ).rejects.toThrow();
    await expect(made.call("write_note", { jobId: "job-1", markdown: "   " })).rejects.toThrow();
    made.pause();
    expect(
      dataOf(await made.call("write_note", { jobId: "job-1", markdown: "ok" }))["section"],
    ).toBe("Fit and gaps");
  });
});
