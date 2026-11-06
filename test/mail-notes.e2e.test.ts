/**
 * End-to-end tests for the mail, notes and interview commands. Every scenario goes through the
 * real entry point `main(argv, overrides)` with a temporary data folder, a fixed clock, a fake
 * mailbox connection that serves the saved fictional emails in `fixtures/mail`, and a fake brain.
 * No network, no real mailbox, no real model, no real personal data.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeConnection, makePosting } from "../fixtures/mail/builders.js";
import { copySampleRepository, sampleNoteReply } from "../fixtures/insight/helpers.js";
import { createApplication, type ApplicationOptions } from "../src/app/index.js";
import { createFakeBrain } from "../src/brain/index.js";
import { createJobFolderManager } from "../src/folders/index.js";
import { ScoutError, type JobRecord, type Posting } from "../src/shared/index.js";
import type { ImapCredentials } from "../src/tracking/index.js";
import { FIXED_NOW, makeDataFolder, runCli } from "./helpers.js";

/** A stand-in password. It must never appear in anything the program prints. */
const SENTINEL_PASSWORD = "sentinel-password-9f3a1c";

/** The environment a configured user would have, with the sentinel as the password. */
const MAIL_ENVIRONMENT = {
  SCOUT_IMAP_HOST: "imap.example.com",
  SCOUT_IMAP_USER: "alex.rivera@example.com",
  SCOUT_IMAP_PASSWORD: SENTINEL_PASSWORD,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The statuses a job passes on its way to `applied`. */
const PATH_TO_APPLIED = [
  "shortlisted",
  "resume-ready",
  "approved",
  "submitting",
  "applied",
] as const;

let folder: ReturnType<typeof makeDataFolder>;

beforeEach(() => {
  folder = makeDataFolder();
});

afterEach(() => {
  folder.remove();
});

/** Overrides every test uses: the temporary folder and a fixed clock. */
function baseOverrides(extra: ApplicationOptions = {}): ApplicationOptions {
  return { directory: folder.directory, now: () => FIXED_NOW, ...extra };
}

/** Installs the fictional sample profile through the real `init` command. */
async function installProfile(): Promise<void> {
  await runCli(["init"], baseOverrides());
}

/**
 * Stores a job and walks it to `applied` at the given time, so its "days without reply" are
 * counted from then. Returns the stored record.
 */
function seedAppliedJob(appliedAt: Date, changes: Partial<Posting>): JobRecord {
  const application = createApplication(baseOverrides({ now: () => appliedAt }));
  try {
    const record = application.jobStore.upsertPosting(makePosting(changes));
    for (const status of PATH_TO_APPLIED) {
      application.jobStore.transition(record.id, status, `test: ${status}`);
    }
    return application.jobStore.get(record.id) as JobRecord;
  } finally {
    application.close();
  }
}

/** Reads a stored job's status through a fresh application. */
function statusOf(jobId: string): string | undefined {
  const application = createApplication(baseOverrides());
  try {
    return application.jobStore.get(jobId)?.status;
  } finally {
    application.close();
  }
}

/** A mailbox connector that serves the named fixtures and records what it was asked to do. */
function fakeMailbox(names: string[]): {
  overrides: ApplicationOptions;
  operations: string[];
  credentialsSeen: ImapCredentials[];
} {
  const { connection, log } = makeFakeConnection(names);
  const credentialsSeen: ImapCredentials[] = [];
  return {
    operations: log.operations,
    credentialsSeen,
    overrides: {
      environment: MAIL_ENVIRONMENT,
      mailboxConnector: (credentials) => {
        credentialsSeen.push(credentials);
        return async () => connection;
      },
    },
  };
}

describe("scout inbox", () => {
  it("moves a matched job to interviewing, reports an illegal move, and lists what it could not match", async () => {
    const job = seedAppliedJob(new Date("2026-11-01T00:00:00.000Z"), {
      id: "harbor-1",
      company: "Harbor Systems",
      title: "Backend Engineer",
    });
    const mailbox = fakeMailbox(["offer", "interview-invite", "rejection", "injection"]);
    const result = await runCli(
      ["inbox", "--since", "2026-11-01"],
      baseOverrides(mailbox.overrides),
    );
    const output = result.lines.join("\n");

    expect(result.exitCode).toBe(0);
    expect(statusOf(job.id)).toBe("interviewing");
    expect(output).toContain("CHANGED: applied -> interviewing");
    // The offer arrived while the job was only applied: reported, never forced.
    expect(output).toMatch(/NOT CHANGED, illegal move/);
    expect(output).not.toMatch(/-> offer/);
    // The Northwind rejection has no job to belong to, and the hostile email changes nothing.
    expect(output).toContain("Not matched to any single application");
    expect(output).toContain("Update on your application to Northwind Labs");
    expect(result.errors).toEqual([]);
  });

  it("only reads: the connection is asked to list, fetch and close, never anything else", async () => {
    seedAppliedJob(new Date("2026-11-01T00:00:00.000Z"), { company: "Harbor Systems" });
    const mailbox = fakeMailbox(["interview-invite"]);
    await runCli(["inbox", "--folder", "Jobs"], baseOverrides(mailbox.overrides));
    expect(mailbox.operations.length).toBeGreaterThan(0);
    for (const operation of mailbox.operations) {
      expect(operation).toMatch(/^(list Jobs |fetch |close$)/);
    }
  });

  it("prints alert emails as leads, resolves a watched company offline, and creates no job", async () => {
    await runCli(
      ["boards", "add", "greenhouse", "northwindlabs", "--company", "Northwind Labs"],
      baseOverrides(),
    );
    const mailbox = fakeMailbox(["alert-linkedin"]);
    const before = await runCli(["jobs"], baseOverrides());
    const result = await runCli(["inbox"], baseOverrides(mailbox.overrides));
    const output = result.lines.join("\n");
    const after = await runCli(["jobs"], baseOverrides());

    expect(output).toContain("Leads from job-alert emails");
    expect(output).toMatch(
      /Backend Engineer at Northwind Labs.*official board greenhouse:northwindlabs/,
    );
    expect(output).toMatch(/Platform Engineer at Lakeside Software.*platform only/);
    expect(after.lines).toEqual(before.lines);
  });

  it("is quiet about an empty mailbox and rejects a malformed date", async () => {
    const mailbox = fakeMailbox([]);
    const empty = await runCli(["inbox"], baseOverrides(mailbox.overrides));
    expect(empty.exitCode).toBe(0);
    expect(empty.lines.join("\n")).toContain("Read 0 message(s)");

    const bad = await runCli(["inbox", "--since", "yesterday"], baseOverrides(mailbox.overrides));
    expect(bad.exitCode).toBe(2);
    expect(bad.errors.join("\n")).toContain("YYYY-MM-DD");
  });

  it("explains how to set the credentials when any are missing, and never opens a connection", async () => {
    let connectorCalls = 0;
    const overrides = baseOverrides({
      environment: { SCOUT_IMAP_HOST: "imap.example.com", SCOUT_IMAP_USER: "" },
      mailboxConnector: () => {
        connectorCalls += 1;
        throw new Error("must not be called");
      },
    });
    const result = await runCli(["inbox"], overrides);
    const message = result.errors.join("\n");

    expect(result.exitCode).toBe(2);
    expect(connectorCalls).toBe(0);
    expect(message).toContain("SCOUT_IMAP_USER");
    expect(message).toContain("SCOUT_IMAP_PASSWORD");
    expect(message).toContain("app-specific password");
    expect(message).toContain("security find-generic-password -s scout-imap -w");
  });

  it("uses the password to connect but never prints it, on success or on failure", async () => {
    seedAppliedJob(new Date("2026-11-01T00:00:00.000Z"), { company: "Harbor Systems" });
    const mailbox = fakeMailbox(["interview-invite", "alert-linkedin", "ambiguous", "recruiter"]);
    const success = await runCli(["inbox"], baseOverrides(mailbox.overrides));
    expect(mailbox.credentialsSeen[0]?.password).toBe(SENTINEL_PASSWORD);

    const failure = await runCli(
      ["inbox"],
      baseOverrides({
        environment: MAIL_ENVIRONMENT,
        mailboxConnector: () => async () => {
          throw new ScoutError(
            "unavailable",
            "Scout could not read the mailbox. Check the settings.",
          );
        },
      }),
    );

    const printed = [...success.lines, ...success.errors, ...failure.lines, ...failure.errors].join(
      "\n",
    );
    expect(failure.exitCode).toBe(6);
    expect(printed).not.toContain(SENTINEL_PASSWORD);
  });
});

describe("scout followups", () => {
  it("prints a draft for an applied job past the waiting time, and never sends or changes anything", async () => {
    await installProfile();
    const old = seedAppliedJob(new Date(FIXED_NOW.getTime() - 10 * DAY_MS), {
      id: "old-1",
      company: "Harbor Systems",
      title: "Backend Engineer",
    });
    const fresh = seedAppliedJob(new Date(FIXED_NOW.getTime() - 1 * DAY_MS), {
      id: "fresh-1",
      company: "Lakeside Software",
      title: "Platform Engineer",
    });
    const result = await runCli(["followups"], baseOverrides());
    const output = result.lines.join("\n");

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Harbor Systems - Backend Engineer");
    expect(output).toContain("Subject: Following up on my application");
    expect(output).toContain("Scout never sends mail");
    expect(output).not.toContain("Lakeside Software");
    expect(statusOf(old.id)).toBe("applied");
    expect(statusOf(fresh.id)).toBe("applied");
  });

  it("says plainly when nothing is due", async () => {
    await installProfile();
    seedAppliedJob(new Date(FIXED_NOW.getTime() - 1 * DAY_MS), { id: "fresh-1" });
    const result = await runCli(["followups"], baseOverrides());
    expect(result.lines.join("\n")).toContain("no follow-up is due");
  });
});

describe("scout funnel", () => {
  it("counts the stored jobs by stage, source and posting age", async () => {
    seedAppliedJob(new Date("2026-11-01T00:00:00.000Z"), {
      id: "a",
      postedAt: "2026-10-31T00:00:00.000Z",
    });
    seedAppliedJob(new Date("2026-11-02T00:00:00.000Z"), {
      id: "b",
      company: "Harbor Systems",
      sources: [{ name: "lever:harbor", url: "https://example.com/b" }],
      canonicalUrl: "https://example.com/b",
      board: "lever",
    });
    const result = await runCli(["funnel"], baseOverrides());
    const output = result.lines.join("\n");

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/^all jobs\s+2\s+2\s+2\s+0\s+0\s+0$/m);
    expect(output).toMatch(/^greenhouse\s+1\s+1\s+1\s+0\s+0\s+0$/m);
    expect(output).toMatch(/^lever\s+1\s+1\s+1\s+0\s+0\s+0$/m);
    expect(output).toMatch(/0-2 days\s+applied\s+1/);
    expect(output).toMatch(/unknown\s+applied\s+1/);
  });
});

describe("scout notes", () => {
  /** A fake brain that replies once with the recorded note for the sample repository. */
  function noteBrain(): ReturnType<typeof createFakeBrain> {
    return createFakeBrain([{ kind: "value", task: "project-note", value: sampleNoteReply() }]);
  }

  it("writes one verified note and prints the verdict, dropped terms and the do-not-claim list", async () => {
    const repository = copySampleRepository();
    const result = await runCli(
      ["notes", "write", repository],
      baseOverrides({ brain: noteBrain() }),
    );
    const output = result.lines.join("\n");

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(folder.directory, "project-notes", "pocket-queue.md"))).toBe(true);
    expect(output).toContain("Verdict:");
    expect(output).toMatch(/Stack terms dropped[^\n]*\n\s+- Kafka/);
    expect(output).toContain("millions of messages per second");
    expect(output).toContain("Do not claim:");
    expect(output).toMatch(/Do not claim:\n\s+- /);
  });

  it("reads a project once: a second write is refused without a model call, and --force replaces it", async () => {
    const repository = copySampleRepository();
    const brain = createFakeBrain([
      { kind: "value", task: "project-note", value: sampleNoteReply() },
      { kind: "value", task: "project-note", value: sampleNoteReply() },
    ]);
    await runCli(["notes", "write", repository], baseOverrides({ brain }));
    expect(brain.receivedPrompts).toHaveLength(1);

    const refused = await runCli(["notes", "write", repository], baseOverrides({ brain }));
    expect(refused.exitCode).toBe(2);
    expect(refused.errors.join("\n")).toMatch(/already exists.*once/);
    expect(brain.receivedPrompts).toHaveLength(1);

    const forced = await runCli(
      ["notes", "write", repository, "--force"],
      baseOverrides({ brain }),
    );
    expect(forced.exitCode).toBe(0);
    expect(brain.receivedPrompts).toHaveLength(2);
  });

  it("reports a model that cannot answer, and writes nothing", async () => {
    const repository = copySampleRepository();
    const brain = createFakeBrain([{ kind: "unavailable" }]);
    const result = await runCli(["notes", "write", repository], baseOverrides({ brain }));
    expect(result.exitCode).toBe(6);
    expect(result.errors.join("\n")).toContain("Nothing was written");
    expect(existsSync(join(folder.directory, "project-notes"))).toBe(false);
  });

  it("lists the notes, and drafts only hold points without touching the profile", async () => {
    await installProfile();
    const profileBefore = readFileSync(join(folder.directory, "profile.json"), "utf8");
    await runCli(["notes", "write", copySampleRepository()], baseOverrides({ brain: noteBrain() }));

    const listed = await runCli(["notes", "list"], baseOverrides());
    expect(listed.lines.join("\n")).toContain("pocket-queue.md");

    const drafted = await runCli(["notes", "draft"], baseOverrides());
    const pointLines = drafted.lines.filter((line) => /^\s+\[[a-z ]+\] /.test(line));
    expect(pointLines.length).toBeGreaterThan(0);
    for (const line of pointLines) expect(line).toMatch(/^\s+\[hold\] /);
    expect(drafted.lines.join("\n")).toContain("Nothing was saved to your profile");
    expect(readFileSync(join(folder.directory, "profile.json"), "utf8")).toBe(profileBefore);
  });

  it("says so when there are no notes yet", async () => {
    const listed = await runCli(["notes", "list"], baseOverrides());
    expect(listed.lines.join("\n")).toContain("No project notes yet");
    const drafted = await runCli(["notes", "draft"], baseOverrides());
    expect(drafted.lines.join("\n")).toContain("nothing to draft");
  });
});

describe("scout interview", () => {
  const description =
    "You will build APIs in Node.js and TypeScript with PostgreSQL. Requirements: strong Node.js, " +
    "TypeScript and Kubernetes experience. Nice to have: Redis.";

  /** A job that has not been applied to, with a description that asks for one skill the profile lacks. */
  function seedJob(): JobRecord {
    const application = createApplication(baseOverrides());
    try {
      return application.jobStore.upsertPosting(
        makePosting({
          id: "interview-1",
          description,
          skills: ["Node.js", "TypeScript", "Kubernetes"],
        }),
      );
    } finally {
      application.close();
    }
  }

  /** A brain that cannot answer, so the plan is built from rules alone. */
  const offlineBrain = (): ReturnType<typeof createFakeBrain> => createFakeBrain([]);

  it("prints a plan whose stories come from the profile and whose gap is answered honestly", async () => {
    await installProfile();
    const job = seedJob();
    const result = await runCli(["interview", job.id], baseOverrides({ brain: offlineBrain() }));
    const output = result.lines.join("\n");
    const profile = readFileSync(join(folder.directory, "profile.json"), "utf8");

    expect(result.exitCode).toBe(0);
    expect(output).toContain("# Interview plan");
    expect(output).toMatch(/Kubernetes/);
    expect(output).toMatch(/I have not used Kubernetes/);
    expect(output).toContain("Resume points used:");
    // Every story is a resume point that exists in the profile: nothing is invented.
    const storyLines = output
      .split("\n")
      .filter((line) => line.startsWith("- What you built (as sent): "));
    expect(storyLines.length).toBeGreaterThan(0);
    for (const line of storyLines) {
      const built = line.slice("- What you built (as sent): ".length).trim();
      expect(profile).toContain(built);
    }
  });

  it("saves to the interview folder when the job has no job folder, and says so", async () => {
    await installProfile();
    const job = seedJob();
    const result = await runCli(
      ["interview", job.id, "--save"],
      baseOverrides({ brain: offlineBrain() }),
    );
    const path = join(folder.directory, "interview", `${job.id}.md`);

    expect(result.exitCode).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("# Interview plan");
    expect(result.lines.join("\n")).toContain("has no job folder yet");
  });

  it("saves into the Interview prep section when the job folder exists, and uses its saved resume", async () => {
    await installProfile();
    const job = seedJob();
    const folders = createJobFolderManager({
      jobsDirectory: join(folder.directory, "jobs"),
      now: () => FIXED_NOW,
    });
    const jobFolder = folders.ensureJobFolder(job);
    folders.saveTailoredResume(jobFolder.name, {
      fileStem: "Alex_Rivera_Northwind",
      texSource: [
        "\\begin{document}",
        "\\section{Experience}",
        "\\resumeSubheading{Software Engineer}{Jul 2023}{Harbor Systems}{Berlin}",
        "\\resumeItem{Built the booking API in Node.js and TypeScript for partner hotels.}",
        "\\end{document}",
      ].join("\n"),
    });
    const result = await runCli(
      ["interview", job.id, "--save"],
      baseOverrides({ brain: offlineBrain() }),
    );
    const text = readFileSync(join(jobFolder.path, "job.md"), "utf8");

    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("the resume saved in the job folder");
    expect(result.lines.join("\n")).toContain(`Saved the plan in the "Interview prep" section`);
    expect(text).toContain("# Interview plan");
    expect(text).toContain("Built the booking API in Node.js and TypeScript");
    expect(existsSync(join(folder.directory, "interview"))).toBe(false);
    expect(readdirSync(join(folder.directory, "jobs"))).toEqual([jobFolder.name]);
  });

  it("fails clearly for a job that does not exist", async () => {
    await installProfile();
    const result = await runCli(
      ["interview", "no-such-job"],
      baseOverrides({ brain: offlineBrain() }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.errors.join("\n")).toContain("No job with id no-such-job");
  });
});
