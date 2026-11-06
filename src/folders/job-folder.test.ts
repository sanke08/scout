import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOB_FIELD_KEYS, JOB_SECTION_TITLES } from "./job-document.js";
import { createJobFolderManager } from "./job-folder.js";
import type { JobFolderManager } from "./job-folder.js";
import { fixedClock, makePosting, makeTemporaryFolder } from "./test-helpers.js";

let temporary: ReturnType<typeof makeTemporaryFolder>;
let jobsDirectory: string;
let folders: JobFolderManager;

beforeEach(() => {
  temporary = makeTemporaryFolder();
  jobsDirectory = join(temporary.path, "jobs");
  folders = createJobFolderManager({ jobsDirectory, now: fixedClock() });
});
afterEach(() => temporary.remove());

describe("ensureJobFolder", () => {
  it("creates a dated Company_Role folder with job.md holding every field and section", () => {
    const folder = folders.ensureJobFolder(makePosting());
    expect(folder).toMatchObject({
      name: "2026-11-07_ExampleCorp_Backend-Engineer",
      created: true,
    });
    const { fields, body } = folders.readJob(folder.name);
    for (const key of JOB_FIELD_KEYS) {
      expect(fields[key]).toBeDefined();
    }
    expect(fields).toMatchObject({
      status: "found",
      company: "ExampleCorp",
      platform: "greenhouse",
      created: "2026-11-07",
      applied: "unknown",
      resume_sent: "unknown",
      experience_asked: "unknown",
      posted_by: "unknown",
    });
    const headings = body
      .split("\n")
      .filter((line) => line.startsWith("## ") && !line.startsWith("## Notes"));
    expect(headings).toEqual(JOB_SECTION_TITLES.map((title) => `## ${title}`));
  });

  it("saves the job description word for word and never overwrites it on a second touch", () => {
    const posting = makePosting();
    const folder = folders.ensureJobFolder(posting);
    const file = join(folder.path, "job.md");
    expect(readFileSync(file, "utf8")).toContain(posting.description);
    folders.appendLogLine(folder.name, "A note.");
    const afterFirst = readFileSync(file, "utf8");

    const again = folders.ensureJobFolder({
      ...posting,
      description: "A completely different text.",
    });
    expect(again).toMatchObject({ name: folder.name, created: false });
    expect(readFileSync(file, "utf8")).toBe(afterFirst);
    expect(readFileSync(file, "utf8")).not.toContain("completely different");
  });

  it("writes unknown for an unknown company and an empty description, never a guess", () => {
    const folder = folders.ensureJobFolder(
      makePosting({ id: "x", company: "", description: "", canonicalUrl: "" }),
    );
    expect(folder.name).toBe("2026-11-07_Unknown_Backend-Engineer");
    const { fields } = folders.readJob(folder.name);
    expect(fields["company"]).toBe("unknown");
    expect(fields["link"]).toBe("unknown");
  });

  it("gives a second posting of the same role -A, then -B, and keeps the first name", () => {
    const first = folders.ensureJobFolder(
      makePosting({ id: "1", canonicalUrl: "https://example.com/jobs/1" }),
    );
    const second = folders.ensureJobFolder(
      makePosting({ id: "2", canonicalUrl: "https://example.com/jobs/2" }),
    );
    const third = folders.ensureJobFolder(
      makePosting({ id: "3", canonicalUrl: "https://example.com/jobs/3" }),
    );
    expect([first.name, second.name, third.name]).toEqual([
      "2026-11-07_ExampleCorp_Backend-Engineer",
      "2026-11-07_ExampleCorp_Backend-Engineer-A",
      "2026-11-07_ExampleCorp_Backend-Engineer-B",
    ]);
  });

  it("uses the recruiter name as the ending when one is given", () => {
    folders.ensureJobFolder(makePosting({ id: "1" }));
    const second = folders.ensureJobFolder(
      makePosting({ id: "2", canonicalUrl: "https://example.com/2" }),
      {
        recruiterName: "jamie lee",
      },
    );
    expect(second.name).toBe("2026-11-07_ExampleCorp_Backend-Engineer-JamieLee");
  });

  it("reuses the folder for the same canonical link or job id, even when the title changes", () => {
    const folder = folders.ensureJobFolder(makePosting());
    const renamedTitle = folders.ensureJobFolder(makePosting({ title: "Staff Engineer" }));
    expect(renamedTitle).toMatchObject({ name: folder.name, created: false });
    expect(readdirSync(jobsDirectory)).toHaveLength(1);
  });

  it("reuses a folder with no known link when the company and role match", () => {
    const folder = folders.ensureJobFolder(makePosting({ id: "lead", canonicalUrl: "" }));
    const found = folders.ensureJobFolder(
      makePosting({ id: "later", company: "examplecorp", title: "backend  engineer" }),
    );
    expect(found).toMatchObject({ name: folder.name, created: false });
  });

  it("never renames a folder: a later date makes a new folder only for a different job", () => {
    const folder = folders.ensureJobFolder(makePosting());
    const later = createJobFolderManager({
      jobsDirectory,
      now: () => new Date("2026-12-25T00:00:00Z"),
    });
    expect(later.ensureJobFolder(makePosting()).name).toBe(folder.name);
    expect(
      later.ensureJobFolder(makePosting({ id: "9", canonicalUrl: "https://example.com/9" })).name,
    ).toBe("2026-12-25_ExampleCorp_Backend-Engineer");
    expect(existsSync(folder.path)).toBe(true);
  });

  it("starts from the stored status when given a job record", () => {
    const folder = folders.ensureJobFolder({
      ...makePosting(),
      status: "shortlisted",
      updatedAt: "2026-11-07T00:00:00Z",
    });
    expect(folders.readJob(folder.name).fields["status"]).toBe("shortlisted");
  });
});

describe("updating a job", () => {
  it("updates the status, stamps applied once, and appends dated log lines", () => {
    const { name } = folders.ensureJobFolder(makePosting());
    folders.setStatus(name, "applied", "form submitted, confirmation seen");
    const { fields } = folders.readJob(name);
    expect(fields["status"]).toBe("applied");
    expect(fields["applied"]).toBe("2026-11-07");
    const text = readFileSync(join(jobsDirectory, name, "job.md"), "utf8");
    expect(text.trimEnd().split("\n").at(-1)).toBe(
      "- 2026-11-07 10:00 UTC: Status is now applied: form submitted, confirmation seen",
    );
  });

  it("refuses an unknown status", () => {
    const { name } = folders.ensureJobFolder(makePosting());
    expect(() => folders.updateFrontMatter(name, { status: "submitted" })).toThrow(
      /not a job status/,
    );
  });

  it("replaces one section without touching the description or others", () => {
    const posting = makePosting({
      description: "## Fit and gaps\nfake heading inside the posting\n",
    });
    const { name } = folders.ensureJobFolder(posting);
    folders.writeSection(name, "Fit and gaps", "Strong on Node.js. Gap: Kafka.");
    const text = readFileSync(join(jobsDirectory, name, "job.md"), "utf8");
    expect(text).toContain("fake heading inside the posting");
    expect(text).toContain("Strong on Node.js. Gap: Kafka.");
    expect(text).toContain("## Recruiter contact\n\nunknown");
    expect(() => folders.writeSection(name, "Job description", "x")).toThrow(/never rewritten/);
    expect(() => folders.writeSection(name, "Interview prep", "## Log")).toThrow(
      /section headings/,
    );
  });

  it("saves the tailored resume as Name_Company.tex and .pdf and records it", () => {
    const { name, path } = folders.ensureJobFolder(makePosting());
    const pdf = join(temporary.path, "built.pdf");
    writeFileSync(pdf, "%PDF fake");
    const saved = folders.saveTailoredResume(name, {
      fileStem: "Alex_Rivera_ExampleCorp",
      texSource: "\\documentclass{article}",
      pdfPath: pdf,
    });
    expect(saved).toEqual(["Alex_Rivera_ExampleCorp.tex", "Alex_Rivera_ExampleCorp.pdf"]);
    expect(readFileSync(join(path, "Alex_Rivera_ExampleCorp.pdf"), "utf8")).toBe("%PDF fake");
    expect(folders.readJob(name).fields["resume_tailored"]).toBe("Alex_Rivera_ExampleCorp.pdf");
  });

  it("copies the exact PDF sent, keeping its file name, and records it", () => {
    const { name, path } = folders.ensureJobFolder(makePosting());
    const pdf = join(temporary.path, "Alex_Rivera_ExampleCorp.pdf");
    writeFileSync(pdf, "%PDF the exact bytes");
    const recorded = folders.recordResumeSent(name, pdf);
    expect(recorded).toBe("sent/Alex_Rivera_ExampleCorp.pdf");
    expect(readFileSync(join(path, recorded), "utf8")).toBe("%PDF the exact bytes");
    expect(folders.readJob(name).fields["resume_sent"]).toBe(recorded);
    expect(() => folders.recordResumeSent(name, join(temporary.path, "missing.pdf"))).toThrow(
      /existing PDF/,
    );
  });
});

describe("safety", () => {
  it("refuses path traversal in folder names and resume stems", () => {
    const { name } = folders.ensureJobFolder(makePosting());
    for (const bad of ["../outside", "a/b", "..", ".hidden", "", "/etc"]) {
      expect(() => folders.readJob(bad)).toThrow(/plain name|leave the folder/);
      expect(() => folders.appendLogLine(bad, "x")).toThrow(/plain name/);
    }
    for (const stem of ["../evil", "a/b", "x y", ""]) {
      expect(() => folders.saveTailoredResume(name, { fileStem: stem, texSource: "x" })).toThrow(
        /may only contain/,
      );
    }
    expect(existsSync(join(temporary.path, "evil.tex"))).toBe(false);
  });

  it("reports a missing folder as not found", () => {
    expect(() => folders.readJob("2026-01-01_Nobody_Nothing")).toThrow(/no job.md/);
  });

  it("leaves no temporary file behind after writes", () => {
    const { name, path } = folders.ensureJobFolder(makePosting());
    folders.appendLogLine(name, "one");
    folders.setStatus(name, "shortlisted", "score 90");
    expect(readdirSync(path).sort()).toEqual(["job.md"]);
  });

  it("keeps the old content when a write fails, with no temporary file left", () => {
    const { name, path } = folders.ensureJobFolder(makePosting());
    const pdf = join(temporary.path, "x.pdf");
    writeFileSync(pdf, "pdf");
    mkdirSync(join(path, "Alex_Rivera_ExampleCorp.pdf"));
    expect(() =>
      folders.saveTailoredResume(name, {
        fileStem: "Alex_Rivera_ExampleCorp",
        texSource: "tex",
        pdfPath: pdf,
      }),
    ).toThrow();
    expect(readdirSync(path).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });
});
