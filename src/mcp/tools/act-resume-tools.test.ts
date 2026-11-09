/**
 * Tests of `build_resume` with the fictional sample profile and a stand-in LaTeX compile.
 *
 * What must stay true: a keyword the profile does not hold is never put on the resume; held,
 * excluded and ask-first points are never used; choices that cannot be honoured come back as an
 * error with the reason; a missing `pdflatex` still saves the source and says so; the tool keeps
 * working while Scout is paused.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScoutError } from "../../shared/index.js";
import { sampleProfile } from "../../apply/test-helpers.js";
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

/** Makes a world without a seeded resume, removed after the test. */
function world(options: ActWorldOptions = {}): ActWorld {
  const made = makeActWorld({ seedResume: false, profile: sampleProfile(), ...options });
  worlds.push(made);
  return made;
}

/** True when the job's folder holds no tailored resume. */
function noResumeSaved(made: ActWorld): boolean {
  const folder = made.application.folders.findJobFolder(made.application.jobStore.get("job-1")!);
  return (
    folder === undefined ||
    made.application.folders.readJob(folder).fields["resume_tailored"] === "unknown"
  );
}

/** The text of the saved LaTeX source. */
function savedSource(data: Record<string, unknown>): string {
  return readFileSync(String(data["texPath"]), "utf8");
}

describe("build_resume", () => {
  it("saves the source and the PDF in the job folder and moves a shortlisted job to resume-ready", async () => {
    const made = world();
    const data = dataOf(
      await made.call("build_resume", { jobId: "job-1", keywords: ["TypeScript", "Kafka"] }),
    );
    expect(existsSync(String(data["texPath"]))).toBe(true);
    expect(existsSync(String(data["pdfPath"]))).toBe(true);
    expect(String(data["path"])).toBe(data["pdfPath"]);
    expect(String(data["path"]).startsWith(join(made.directory, "jobs"))).toBe(true);
    expect(data["keywordsUsed"]).toEqual(expect.arrayContaining(["typescript", "kafka"]));
    expect(data["status"]).toBe("resume-ready");
    expect(made.status()).toBe("resume-ready");
    expect(data["pageFit"]).toMatchObject({ pages: 1, compiledToOnePage: true });
  });

  it("never adds a keyword the profile does not hold, and says which were refused", async () => {
    const made = world();
    const data = dataOf(
      await made.call("build_resume", { jobId: "job-1", keywords: ["TypeScript", "Cobol", "SAP"] }),
    );
    expect(data["keywordsRefused"]).toEqual(expect.arrayContaining(["cobol", "sap"]));
    expect(data["keywordsUsed"]).not.toContain("cobol");
    expect(savedSource(data).toLowerCase()).not.toContain("cobol");
    expect(savedSource(data)).not.toContain("SAP");
  });

  it("only uses the points the model chose for an entry", async () => {
    const made = world();
    const data = dataOf(
      await made.call("build_resume", {
        jobId: "job-1",
        keywords: ["TypeScript"],
        pointChoices: [{ section: "experience", name: "Harbor Systems", points: [1] }],
      }),
    );
    const used = data["pointsUsed"] as { name: string; position: number }[];
    const harbor = used.filter((point) => point.name === "Harbor Systems").map((p) => p.position);
    expect(harbor).toEqual([1]);
  });

  it("refuses a held point with the reason, and does not save anything", async () => {
    const profile = sampleProfile();
    const entry = profile.experience[0]!;
    entry.points[2]!.status = "hold";
    const made = world({ profile });
    const message = errorOf(
      await made.call("build_resume", {
        jobId: "job-1",
        keywords: ["TypeScript"],
        pointChoices: [{ section: "experience", name: entry.org, points: [2] }],
      }),
    );
    expect(message).toMatch(/status "hold".*never put on a resume/);
    expect(noResumeSaved(made)).toBe(true);
  });

  it("never prints a held or excluded point even when the model asks for no choices", async () => {
    const profile = sampleProfile();
    const secret = "Fictional held claim about a unicorn migration";
    profile.experience[0]!.points.push({
      text: secret,
      allowed: ["Unicorn"],
      variants: [],
      status: "hold",
    });
    const made = world({ profile });
    const data = dataOf(await made.call("build_resume", { jobId: "job-1", keywords: ["Unicorn"] }));
    expect(savedSource(data)).not.toContain("unicorn migration");
    expect(data["keywordsRefused"]).toContain("unicorn");
  });

  it("says what is wrong with an unknown entry or a position that does not exist", async () => {
    const made = world();
    expect(
      errorOf(
        await made.call("build_resume", {
          jobId: "job-1",
          keywords: [],
          pointChoices: [{ section: "project", name: "No Such Project", points: [0] }],
        }),
      ),
    ).toMatch(/no project named "No Such Project".*Message Queue/);
    expect(
      errorOf(
        await made.call("build_resume", {
          jobId: "job-1",
          keywords: [],
          pointChoices: [{ section: "project", name: "Message Queue", points: [9] }],
        }),
      ),
    ).toMatch(/position 9 does not exist/);
  });

  it("saves the source and says so when LaTeX is not installed", async () => {
    const made = world({
      compileFailure: new ScoutError("unavailable", "pdflatex is not installed."),
    });
    const data = dataOf(await made.call("build_resume", { jobId: "job-1", keywords: ["Go"] }));
    expect(data["pdfPath"]).toBeNull();
    expect(String(data["pdfNote"])).toMatch(/pdflatex is not installed/);
    expect(existsSync(String(data["texPath"]))).toBe(true);
    expect(data["path"]).toBe(data["texPath"]);
  });

  it("returns the reason when the LaTeX does not compile, and saves nothing", async () => {
    const made = world({ compileFailure: new ScoutError("invalid-input", "LaTeX error: oops.") });
    expect(errorOf(await made.call("build_resume", { jobId: "job-1", keywords: [] }))).toMatch(
      /LaTeX error: oops/,
    );
    expect(noResumeSaved(made)).toBe(true);
  });

  it("works while Scout is paused and fails plainly for an unknown job", async () => {
    const made = world();
    made.pause();
    expect(
      dataOf(await made.call("build_resume", { jobId: "job-1", keywords: [] }))["pdfPath"],
    ).not.toBeNull();
    expect(errorOf(await made.call("build_resume", { jobId: "nope", keywords: [] }))).toMatch(
      /No job with id nope/,
    );
  });

  it("rejects input that is too large before the handler runs", async () => {
    const made = world();
    await expect(
      made.call("build_resume", {
        jobId: "job-1",
        keywords: Array.from({ length: 41 }, () => "x"),
      }),
    ).rejects.toThrow();
  });
});
