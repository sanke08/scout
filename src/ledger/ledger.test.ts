import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createActionLog,
  createJobStore,
  openDatabase,
  type DatabaseSync,
} from "../store/index.js";
import { makePosting, makeTemporaryFolder } from "../store/test-helpers.js";
import type { JobStore } from "../shared/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createLedgerStore } from "./ledger-store.js";
import { withLedger } from "./with-ledger.js";

let folder: { path: string; remove: () => void };
let database: DatabaseSync;
let jobs: JobStore;
let ledger: Ledger;
let clock: Date;
const fileErrors: string[] = [];

beforeEach(() => {
  folder = makeTemporaryFolder();
  clock = new Date("2026-11-09T10:00:00.000Z");
  const now = (): Date => clock;
  database = openDatabase(join(folder.path, "scout.sqlite"));
  const inner = createJobStore(database, now);
  createActionLog(database, now);
  jobs = withLedger(
    inner,
    () => ledger,
    (message) => fileErrors.push(message),
  );
  ledger = createLedger({
    jobStore: jobs,
    store: createLedgerStore(database),
    now,
    filePath: join(folder.path, "APPLICATIONS.md"),
    onFileError: (message) => fileErrors.push(message),
  });
  fileErrors.length = 0;
});

afterEach(() => {
  database.close();
  folder.remove();
});

/** Takes a discovered job all the way through Scout's own submit path. */
function submitThroughScout(id = "job-1"): void {
  jobs.upsertPosting(
    makePosting({ id, canonicalUrl: "https://boards.greenhouse.io/acme/jobs/4412345" }),
  );
  for (const status of ["shortlisted", "approved", "submitting", "applied"] as const) {
    jobs.transition(id, status, `to ${status}`);
  }
}

describe("a job Scout submitted", () => {
  it("appears in the ledger with its applied time, job number and a history line", () => {
    submitThroughScout();
    const detail = ledger.get("job-1")!;
    expect(detail.status).toBe("applied");
    expect(detail.jobNumber).toBe("4412345");
    expect(detail.appliedAt).toBe("2026-11-09T10:00:00.000Z");
    expect(detail.events.map((event) => event.kind)).toEqual(
      ["status", "status", "applied"].slice(2),
    );
  });

  it("is not listed before it was sent", () => {
    jobs.upsertPosting(makePosting({ id: "job-2" }));
    jobs.transition("job-2", "shortlisted", "good fit");
    expect(ledger.list()).toEqual([]);
    expect(ledger.get("job-2")).toBeUndefined();
  });
});

describe("recording an application made elsewhere", () => {
  it("creates the job as applied on the date given, with recruiter details", () => {
    const saved = ledger.addManual({
      company: "Northwind",
      title: "Platform Engineer",
      link: "https://careers.example.com/jobs/NW-20931",
      appliedOn: "2026-11-02",
      details: { recruiterName: "Sam Okafor", recruiterPhone: "+1 555 0100" },
    });
    expect(saved.status).toBe("applied");
    expect(saved.appliedAt).toBe("2026-11-02T12:00:00.000Z");
    expect(saved.details.appliedVia).toBe("manual");
    expect(saved.details.recruiterName).toBe("Sam Okafor");
  });

  it("works without a link", () => {
    const saved = ledger.addManual({ company: "Contoso", title: "Backend Engineer" });
    expect(saved.link).toBe("");
    expect(saved.status).toBe("applied");
  });

  it("refuses to record the same application twice", () => {
    ledger.addManual({
      company: "Contoso",
      title: "Backend Engineer",
      link: "https://example.com/jobs/12345",
    });
    expect(() =>
      ledger.addManual({
        company: "Contoso",
        title: "Backend Engineer",
        link: "https://example.com/jobs/12345",
      }),
    ).toThrow(/already in the ledger/);
  });

  it("picks up a job Scout already found and moves it forward", () => {
    jobs.upsertPosting(makePosting({ id: "x", canonicalUrl: "https://example.com/jobs/777777" }));
    const saved = ledger.addManual({
      company: "ExampleCorp",
      title: "Backend Engineer",
      link: "https://example.com/jobs/777777",
    });
    expect(saved.status).toBe("applied");
  });

  it("rejects a bad link and a missing company", () => {
    expect(() => ledger.addManual({ company: "A", title: "B", link: "not a link" })).toThrow(
      /web address/,
    );
    expect(() => ledger.addManual({ company: "", title: "B" })).toThrow();
  });
});

describe("reporting a status", () => {
  it("records a rejection with the note and then allows nothing further", () => {
    submitThroughScout();
    const saved = ledger.setStatus("job-1", "rejected", "Email from Sam", "2026-11-08");
    expect(saved.status).toBe("rejected");
    const moved = saved.events.find((event) => event.summary === "applied -> rejected");
    expect(moved?.detail).toContain("Email from Sam");
    expect(moved?.at).toBe("2026-11-08T12:00:00.000Z");
    expect(saved.allowedStatuses).toEqual([]);
    expect(() => ledger.setStatus("job-1", "interviewing")).toThrow(/cannot be moved/);
  });

  it("walks the legal steps when the user reports an offer straight from applied", () => {
    submitThroughScout();
    const saved = ledger.setStatus("job-1", "offer", "Verbal offer by phone");
    expect(saved.status).toBe("offer");
    const moves = saved.events
      .filter((event) => event.kind === "status")
      .map((event) => event.summary);
    expect(moves).toEqual(["applied -> contacted", "contacted -> offer"]);
  });

  it("refuses a status that is not reachable and says what is", () => {
    submitThroughScout();
    expect(() => ledger.setStatus("job-1", "found")).toThrow(/You can report/);
    expect(ledger.get("job-1")!.status).toBe("applied");
  });

  it("never lets a sent application be reported as skipped", () => {
    submitThroughScout();
    expect(() => ledger.setStatus("job-1", "skipped")).toThrow();
  });

  it("reports an unknown application as not found", () => {
    expect(() => ledger.setStatus("nope", "rejected")).toThrow(/No application/);
  });
});

describe("history, details and search", () => {
  it("adds calls to the history and finds the application by who called", () => {
    submitThroughScout();
    ledger.saveDetails("job-1", { recruiterName: "Sam Okafor", recruiterPhone: "+1 555 0100" });
    ledger.addEvent("job-1", {
      kind: "call",
      summary: "Phone screen booked for Friday",
      contact: "Sam Okafor",
      at: "2026-11-10",
    });
    expect(ledger.list({ search: "okafor" }).map((entry) => entry.id)).toEqual(["job-1"]);
    expect(ledger.list({ search: "555 0100" })).toHaveLength(1);
    expect(ledger.list({ search: "phone screen" })).toHaveLength(1);
    expect(ledger.list({ search: "okafor nobody" })).toEqual([]);
    expect(ledger.get("job-1")!.events.at(-1)?.kind).toBe("call");
  });

  it("matches search text literally, not as a pattern", () => {
    submitThroughScout();
    ledger.addEvent("job-1", { kind: "note", summary: "salary 100% remote" });
    expect(ledger.list({ search: "100%" })).toHaveLength(1);
    expect(ledger.list({ search: "%" })).toHaveLength(1);
    expect(ledger.list({ search: "_" })).toEqual([]);
  });

  it("clears a field with an empty string and keeps the others", () => {
    submitThroughScout();
    ledger.saveDetails("job-1", { recruiterName: "Sam", recruiterEmail: "sam@example.com" });
    const saved = ledger.saveDetails("job-1", { recruiterEmail: "" });
    expect(saved.details).toEqual({ recruiterName: "Sam" });
  });

  it("uses the saved job number over the one worked out from the link", () => {
    submitThroughScout();
    expect(ledger.saveDetails("job-1", { externalJobId: "REQ-88" }).jobNumber).toBe("REQ-88");
  });

  it("refuses a bad date for the next step and a blank summary", () => {
    submitThroughScout();
    expect(() => ledger.saveDetails("job-1", { nextStepDate: "next week" })).toThrow();
    expect(() => ledger.addEvent("job-1", { kind: "note", summary: "  " })).toThrow();
  });

  it("flags a due next step until the application is finished", () => {
    submitThroughScout();
    ledger.saveDetails("job-1", { nextStep: "Call Sam back", nextStepDate: "2026-11-09" });
    expect(ledger.due().map((entry) => entry.id)).toEqual(["job-1"]);
    ledger.setStatus("job-1", "withdrawn");
    expect(ledger.due()).toEqual([]);
  });

  it("filters by status", () => {
    submitThroughScout("a");
    submitThroughScout("b");
    ledger.setStatus("b", "rejected");
    expect(ledger.list({ statuses: ["rejected"] }).map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("APPLICATIONS.md", () => {
  it("is rewritten after every change and holds the recruiter, job id, link and history", () => {
    submitThroughScout();
    ledger.saveDetails("job-1", { recruiterName: "Sam Okafor", recruiterPhone: "+1 555 0100" });
    ledger.addEvent("job-1", {
      kind: "call",
      summary: "Phone screen booked",
      contact: "Sam Okafor",
    });
    ledger.setStatus("job-1", "rejected", "Position filled");
    const text = readFileSync(join(folder.path, "APPLICATIONS.md"), "utf8");
    expect(text).toContain("# Applications");
    expect(text).toContain("Sam Okafor");
    expect(text).toContain("+1 555 0100");
    expect(text).toContain("4412345");
    expect(text).toContain("https://boards.greenhouse.io/acme/jobs/4412345");
    expect(text).toContain("[call]");
    expect(text).toContain("Position filled");
    expect(text).toMatch(/## Finished[\s\S]*rejected/);
  });

  it("keeps a table cell with a pipe or line break on one row", () => {
    submitThroughScout();
    ledger.saveDetails("job-1", { nextStep: "ask | about\nsalary" });
    const text = ledger.renderMarkdown();
    expect(text).toContain("ask \\| about salary");
  });

  it("is a valid empty file when nothing is recorded", () => {
    const text = ledger.renderMarkdown();
    expect(text).toContain("0 applications");
    expect(text).toContain("Nothing is recorded yet.");
  });

  it("does not block a change when the file cannot be written", () => {
    const blocked = createLedger({
      jobStore: jobs,
      store: createLedgerStore(database),
      now: () => clock,
      filePath: join(folder.path, "APPLICATIONS.md", "inner", "x.md"),
      onFileError: (message) => fileErrors.push(message),
    });
    submitThroughScout("zzz");
    expect(() => blocked.addEvent("zzz", { kind: "note", summary: "still saved" })).not.toThrow();
    expect(blocked.get("zzz")!.events.at(-1)?.summary).toBe("still saved");
    expect(existsSync(join(folder.path, "APPLICATIONS.md"))).toBe(true);
  });
});
