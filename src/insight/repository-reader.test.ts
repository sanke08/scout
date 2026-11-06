import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { readRepository } from "./repository-reader.js";
import { copySampleRepository, makeScratchFolder } from "./test-helpers.js";

/** Lists every file path under `folder` with its size and modification time, for before/after checks. */
function snapshot(folder: string, prefix = ""): string[] {
  const lines: string[] = [];
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    const details = statSync(path);
    lines.push(`${prefix}${name} ${details.size} ${details.mtimeMs}`);
    if (details.isDirectory()) {
      lines.push(...snapshot(path, `${prefix}${name}/`));
    }
  }
  return lines;
}

describe("readRepository", () => {
  it("returns the tree, README, configuration and source of the sample repository", () => {
    const digest = readRepository(copySampleRepository());
    expect(digest.name).toBe("pocket-queue");
    expect(digest.readme?.path).toBe("README.md");
    expect(digest.configFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(["package.json", "Dockerfile", ".github/workflows/ci.yml"]),
    );
    expect(digest.sourceFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining(["src/index.ts", "src/lease.ts", "src/server.ts"]),
    );
    expect(digest.tree).toContain("src/lease.ts");
    expect(digest.limitsHit).toEqual([]);
  });

  it("never follows a symbolic link out of the folder", () => {
    const repository = copySampleRepository();
    const outside = makeScratchFolder();
    writeFileSync(join(outside, "stolen.ts"), "export const OUTSIDE_SECRET = 1;\n");
    symlinkSync(outside, join(repository, "linked-folder"));
    symlinkSync(join(outside, "stolen.ts"), join(repository, "src", "leak.ts"));

    const digest = readRepository(repository);

    const everythingKept = JSON.stringify(digest);
    expect(everythingKept).not.toContain("OUTSIDE_SECRET");
    expect(digest.tree.some((path) => path.includes("linked-folder"))).toBe(false);
    expect(digest.skipped).toEqual(
      expect.arrayContaining([
        { path: "linked-folder", reason: "symlink" },
        { path: "src/leak.ts", reason: "symlink" },
      ]),
    );
  });

  it("skips a file bigger than the size limit and reports it", () => {
    const repository = copySampleRepository();
    writeFileSync(join(repository, "src", "huge.ts"), `// ${"x".repeat(5000)}\n`);

    const digest = readRepository(repository, { maxFileBytes: 4000 });

    expect(digest.skipped).toContainEqual({ path: "src/huge.ts", reason: "too-large" });
    expect(digest.sourceFiles.map((file) => file.path)).not.toContain("src/huge.ts");
    expect(digest.tree).not.toContain("src/huge.ts");
  });

  it("ignores dependency, version control and build folders", () => {
    const repository = copySampleRepository();
    for (const folder of ["node_modules/pkg", ".git/objects", "dist"]) {
      mkdirSync(join(repository, folder), { recursive: true });
      writeFileSync(join(repository, folder, "inside.js"), "export const HIDDEN_DEPENDENCY = 1;\n");
    }

    const digest = readRepository(repository);

    expect(JSON.stringify(digest)).not.toContain("HIDDEN_DEPENDENCY");
    expect(digest.skipped.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["node_modules/", ".git/", "dist/"]),
    );
  });

  it("never reads secrets or binary files", () => {
    const repository = copySampleRepository();
    writeFileSync(join(repository, ".env"), "API_TOKEN=do-not-read-this\n");
    writeFileSync(join(repository, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 1, 2]));
    writeFileSync(join(repository, "src", "blob.ts"), Buffer.from([99, 111, 0, 110, 115, 116]));

    const digest = readRepository(repository);

    expect(JSON.stringify(digest)).not.toContain("do-not-read-this");
    expect(digest.skipped).toEqual(
      expect.arrayContaining([
        { path: ".env", reason: "secret-like" },
        { path: "logo.png", reason: "binary" },
        { path: "src/blob.ts", reason: "binary" },
      ]),
    );
    expect(digest.sourceFiles.map((file) => file.path)).not.toContain("src/blob.ts");
  });

  it("stops at the entry limit and says so", () => {
    const digest = readRepository(copySampleRepository(), { maxEntries: 3 });
    expect(digest.limitsHit).toContain("entries");
  });

  it("keeps source text within the byte budget and lists the rest as over budget", () => {
    const digest = readRepository(copySampleRepository(), { maxSourceBytes: 300 });
    const sourceBytes = digest.sourceFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.text, "utf8"),
      0,
    );
    expect(sourceBytes).toBeLessThanOrEqual(300);
    expect(digest.sourceFiles.some((file) => file.truncated)).toBe(true);
    expect(digest.skipped.some((entry) => entry.reason === "over-budget")).toBe(true);
  });

  it("limits the listed tree", () => {
    const digest = readRepository(copySampleRepository(), { maxTreeEntries: 2 });
    expect(digest.tree).toHaveLength(2);
    expect(digest.limitsHit).toContain("tree-size");
  });

  it("does not change anything inside the repository", () => {
    const repository = copySampleRepository();
    const before = snapshot(repository);
    readRepository(repository);
    expect(snapshot(repository)).toEqual(before);
  });

  it("only reads: a script in the repository is never run", () => {
    const repository = copySampleRepository();
    const marker = join(repository, "ran.txt");
    writeFileSync(
      join(repository, "src", "setup.js"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`,
    );
    readRepository(repository);
    expect(() => readFileSync(marker)).toThrow();
  });

  it("reports a missing folder and a bad limit with full-sentence errors", () => {
    const missing = join(makeScratchFolder(), "nowhere");
    expect(() => readRepository(missing)).toThrow(ScoutError);
    expect(() => readRepository(missing)).toThrow(/project folder/);
    expect(() => readRepository(copySampleRepository(), { maxDepth: 0 })).toThrow(/maxDepth/);
  });
});
