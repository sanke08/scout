/**
 * End-to-end tests for the job-folder and operations commands, through the real `main(argv)`:
 * folder creation on shortlist, `resume --job`, `board`, `status`, `backup`, `restore`, `leads`
 * and `service plist`. Fake network and model, fixed clock, temporary folders, fictional data.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication, type ApplicationOptions } from "../src/app/index.js";
import {
  FIXED_NOW,
  makeDataFolder,
  makeFakeNetwork,
  makeScoringBrain,
  runCli,
  type FakeNetwork,
} from "./helpers.js";

let folder: ReturnType<typeof makeDataFolder>;
let network: FakeNetwork;
let outside: string;

beforeEach(() => {
  folder = makeDataFolder();
  network = makeFakeNetwork();
  outside = mkdtempSync(join(tmpdir(), "scout-outside-"));
});

afterEach(() => {
  folder.remove();
  rmSync(outside, { recursive: true, force: true });
});

/** Overrides every test uses: the temporary folder, the fake network and a fixed clock. */
function baseOverrides(extra: ApplicationOptions = {}): ApplicationOptions {
  return {
    directory: folder.directory,
    fetchImpl: network.fetchImpl,
    hostDelayMilliseconds: 0,
    now: () => FIXED_NOW,
    ...extra,
  };
}

/** Sets up a profile and one watched board, then runs one discovery pass that shortlists one job. */
async function discoverOneShortlistedJob(): Promise<void> {
  await runCli(["init"], baseOverrides());
  await runCli(["boards", "add", "greenhouse", "harborjobs"], baseOverrides());
  await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
}

/** The names of the job folders in the data folder. */
function jobFolderNames(): string[] {
  const jobs = join(folder.directory, "jobs");
  return existsSync(jobs) ? readdirSync(jobs).filter((name) => !name.endsWith(".md")) : [];
}

/** The stored shortlisted job, read through a fresh application. */
function shortlistedJob(): { id: string; description: string; company: string } {
  const application = createApplication(baseOverrides());
  try {
    const job = application.jobStore.list({ status: "shortlisted" })[0]!;
    return { id: job.id, description: job.description, company: job.company };
  } finally {
    application.close();
  }
}

describe("job folders from discovery", () => {
  it("creates one folder per shortlisted job with the description word for word, and reuses it", async () => {
    await discoverOneShortlistedJob();
    const names = jobFolderNames();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^2026-11-07_Harborjobs_Backend-Engineer$/);
    const job = shortlistedJob();
    const text = readFileSync(join(folder.directory, "jobs", names[0]!, "job.md"), "utf8");
    expect(text).toContain(job.description);
    expect(text).toMatch(/status: shortlisted/);
    expect(text).toContain(`job_id: ${job.id}`);

    await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    expect(jobFolderNames()).toEqual(names);
  });

  it("gives no folder to jobs a rule skipped or that were never shortlisted", async () => {
    await runCli(["init"], baseOverrides());
    await runCli(["boards", "add", "greenhouse", "examplecorp"], baseOverrides());
    await runCli(["discover"], baseOverrides({ brain: makeScoringBrain(85, 85) }));
    const application = createApplication(baseOverrides());
    try {
      expect(application.jobStore.list({ status: "skipped" }).length).toBeGreaterThan(0);
    } finally {
      application.close();
    }
    const shortlisted = shortlistedJobsCount();
    expect(jobFolderNames()).toHaveLength(shortlisted);
  });

  it("follows a later store transition into job.md, and the store stays the source of truth", async () => {
    await discoverOneShortlistedJob();
    const job = shortlistedJob();
    const application = createApplication(baseOverrides());
    try {
      application.jobStore.transition(job.id, "resume-ready", "Resume built.");
    } finally {
      application.close();
    }
    const text = readFileSync(
      join(folder.directory, "jobs", jobFolderNames()[0]!, "job.md"),
      "utf8",
    );
    expect(text).toMatch(/status: resume-ready/);
    expect(text).toMatch(/Status is now resume-ready: Resume built\./);
  });
});

/** How many jobs are shortlisted now. */
function shortlistedJobsCount(): number {
  const application = createApplication(baseOverrides());
  try {
    return application.jobStore.list({ status: "shortlisted" }).length;
  } finally {
    application.close();
  }
}

describe("scout resume --job", () => {
  it("saves the .tex in the job's folder, records resume_tailored and changes no status", async () => {
    await discoverOneShortlistedJob();
    const job = shortlistedJob();
    const result = await runCli(
      ["resume", "--job", job.id, "--keywords", "Kubernetes"],
      baseOverrides(),
    );
    expect(result.exitCode).toBe(0);
    const directory = join(folder.directory, "jobs", jobFolderNames()[0]!);
    const tex = readdirSync(directory).filter((name) => name.endsWith(".tex"));
    expect(tex).toHaveLength(1);
    const source = readFileSync(join(directory, tex[0]!), "utf8");
    expect(source).not.toMatch(/Kubernetes/);
    expect(result.lines.join("\n")).toMatch(/Not in your profile, so not added: .*kubernetes/i);
    const text = readFileSync(join(directory, "job.md"), "utf8");
    expect(text).toContain(`resume_tailored: ${tex[0]}`);
    expect(text).toMatch(/status: shortlisted/);
    expect(shortlistedJobsCount()).toBe(1);
  });

  it("refuses an unknown job and --out together with --job", async () => {
    await runCli(["init"], baseOverrides());
    const unknown = await runCli(["resume", "--job", "nope"], baseOverrides());
    expect(unknown.exitCode).toBe(3);
    expect(unknown.errors.join("\n")).toMatch(/scout jobs/);
    const both = await runCli(["resume", "--job", "x", "--out", outside], baseOverrides());
    expect(both.exitCode).toBe(2);
  });
});

describe("scout board", () => {
  it("writes BOARD.md and prints totals that match the folders", async () => {
    await discoverOneShortlistedJob();
    const result = await runCli(["board"], baseOverrides());
    expect(result.exitCode).toBe(0);
    const text = result.lines.join("\n");
    expect(text).toContain("shortlisted: 1");
    expect(text).toContain("Total: 1 job");
    const board = readFileSync(join(folder.directory, "jobs", "BOARD.md"), "utf8");
    expect(board).toContain("Harborjobs");
  });

  it("works with no jobs at all", async () => {
    const result = await runCli(["board"], baseOverrides());
    expect(result.exitCode).toBe(0);
    expect(result.lines.join("\n")).toContain("Total: 0 jobs");
  });
});

describe("scout status", () => {
  it("prints the health report with queue sizes, boards and the model calls used today", async () => {
    await discoverOneShortlistedJob();
    writeFileSync(
      join(folder.directory, "model-budget.json"),
      JSON.stringify({ day: "2026-11-07", used: 7 }),
    );
    const result = await runCli(["status"], baseOverrides());
    const text = result.lines.join("\n");
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/Automation: running/);
    expect(text).toMatch(/Model calls today: 7 of \d+/);
    expect(text).toMatch(/shortlisted/);
    expect(text).toMatch(/Boards watched: 1\./);
    expect(text).not.toMatch(/must hold a list/);
  });

  it("says the kill switch is on after pause", async () => {
    await runCli(["pause"], baseOverrides());
    const result = await runCli(["status"], baseOverrides());
    expect(result.lines.join("\n")).toMatch(/PAUSED/);
  });
});

describe("scout backup and restore", () => {
  it("backs up the data but never a sessions folder or a .env file, and restores into an empty folder", async () => {
    await discoverOneShortlistedJob();
    mkdirSync(join(folder.directory, "sessions"));
    writeFileSync(join(folder.directory, "sessions", "cookies.txt"), "fake-cookie");
    writeFileSync(join(folder.directory, ".env"), "FAKE_TOKEN=not-real");
    mkdirSync(join(folder.directory, "jobs", "sessions"));
    writeFileSync(join(folder.directory, "jobs", "sessions", "cookies.txt"), "fake-cookie");

    const backupTarget = join(outside, "backups");
    const made = await runCli(["backup", "--to", backupTarget], baseOverrides());
    expect(made.exitCode).toBe(0);
    const [backupName] = readdirSync(backupTarget);
    expect(backupName).toMatch(/^scout-backup-/);
    const backupPath = join(backupTarget, backupName!);
    const everything = readdirSync(backupPath, { recursive: true }).map(String);
    expect(everything.some((name) => name.includes("sessions"))).toBe(false);
    expect(everything.some((name) => name.includes(".env"))).toBe(false);
    expect(everything).toContain("profile.json");
    expect(everything).toContain("scout.sqlite");
    expect(everything.some((name) => name.endsWith("job.md"))).toBe(true);

    const fresh = join(outside, "fresh-data");
    const restored = await runCli(["restore", "--from", backupPath], { directory: fresh });
    expect(restored.exitCode).toBe(0);
    expect(existsSync(join(fresh, "profile.json"))).toBe(true);
    expect(existsSync(join(fresh, "scout.sqlite"))).toBe(true);
  });

  it("refuses a destination inside the data folder", async () => {
    await runCli(["init"], baseOverrides());
    const result = await runCli(
      ["backup", "--to", join(folder.directory, "inside")],
      baseOverrides(),
    );
    expect(result.exitCode).toBe(2);
    expect(result.errors.join("\n")).toMatch(/inside the data folder/);
  });

  it("refuses to restore into a data folder that has files unless overwrite is given", async () => {
    await runCli(["init"], baseOverrides());
    const backupTarget = join(outside, "backups");
    await runCli(["backup", "--to", backupTarget], baseOverrides());
    const backupPath = join(backupTarget, readdirSync(backupTarget)[0]!);

    const edited = join(folder.directory, "profile.json");
    writeFileSync(edited, '{"edited":true}');
    const refused = await runCli(["restore", "--from", backupPath], baseOverrides());
    expect(refused.exitCode).toBe(8);
    expect(refused.errors.join("\n")).toMatch(/already has files/);
    expect(readFileSync(edited, "utf8")).toBe('{"edited":true}');

    const allowed = await runCli(["restore", "--from", backupPath, "--overwrite"], baseOverrides());
    expect(allowed.exitCode).toBe(0);
    expect(readFileSync(edited, "utf8")).not.toBe('{"edited":true}');
  });

  it("refuses a folder that is not a backup", async () => {
    const result = await runCli(["restore", "--from", outside], { directory: join(outside, "d") });
    expect(result.exitCode).toBe(2);
    expect(result.errors.join("\n")).toMatch(/not a Scout backup/);
  });
});

describe("scout leads", () => {
  it("writes a leads file from a JSON file and lists the latest", async () => {
    const source = join(outside, "rows.json");
    writeFileSync(
      source,
      JSON.stringify([
        { company: "Northwind Labs", role: "Backend Engineer", link: "https://example.com/1" },
        {
          company: "Harbor Jobs",
          role: "Platform Engineer",
          listedSkills: ["Go"],
          notes: "remote",
        },
      ]),
    );
    const added = await runCli(
      ["leads", "add", "--from", source, "--source", "remote-feed"],
      baseOverrides(),
    );
    expect(added.exitCode).toBe(0);
    expect(added.lines.join("\n")).toMatch(/Wrote 2 lead\(s\).*round 1/);
    await runCli(["leads", "add", "--from", source, "--source", "remote-feed"], baseOverrides());
    const files = readdirSync(join(folder.directory, "leads"));
    expect(files).toEqual(["2026-11-07_remote-feed-round1.md", "2026-11-07_remote-feed-round2.md"]);
    const listed = await runCli(["leads", "list"], baseOverrides());
    expect(listed.lines.join("\n")).toContain("round2.md");
    expect(listed.lines.join("\n")).toContain("Northwind Labs");
  });

  it("says so when there are no leads, and rejects a bad file with a full sentence", async () => {
    const none = await runCli(["leads", "list"], baseOverrides());
    expect(none.lines.join("\n")).toMatch(/no leads yet/);
    const bad = join(outside, "bad.json");
    writeFileSync(bad, JSON.stringify([{ company: "No Role Inc" }]));
    const result = await runCli(["leads", "add", "--from", bad], baseOverrides());
    expect(result.exitCode).toBe(2);
    expect(result.errors.join("\n")).toMatch(/company and a role/);
    const missing = await runCli(
      ["leads", "add", "--from", join(outside, "none.json")],
      baseOverrides(),
    );
    expect(missing.exitCode).toBe(3);
  });
});

describe("scout service plist", () => {
  it("prints the plist on standard output only and the steps on standard error, writing nothing", async () => {
    const before = readdirSync(outside);
    const result = await runCli(
      ["service", "plist", "--program", "/opt/scout/dist/index.js"],
      baseOverrides(),
    );
    expect(result.exitCode).toBe(0);
    const out = result.lines.join("\n");
    expect(out).toMatch(/^<\?xml/);
    expect(out).toContain("/opt/scout/dist/index.js");
    expect(out).toContain("<key>KeepAlive</key>");
    expect(out).not.toMatch(/launchctl/);
    expect(result.errors.join("\n")).toMatch(/Nothing was installed/);
    expect(result.errors.join("\n")).toMatch(/launchctl bootstrap/);
    expect(readdirSync(outside)).toEqual(before);
    expect(existsSync(join(folder.directory, "logs"))).toBe(false);
  });
});
