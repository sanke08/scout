/** Tests for the memory and file caches, including reopening and damaged files. */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileCache, createMemoryCache } from "./cache.js";

/** Temporary folders created by a test, removed afterwards. */
const folders: string[] = [];
/** Creates an empty temporary folder for one test. */
async function makeFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "scout-brain-cache-"));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("memory cache", () => {
  it("returns what was stored and nothing for an unknown key", async () => {
    const cache = createMemoryCache();
    await cache.set("k", { engine: "claude", value: { a: 1 } });
    expect(await cache.get("k")).toEqual({ engine: "claude", value: { a: 1 } });
    expect(await cache.get("other")).toBeUndefined();
  });
});

describe("file cache", () => {
  it("survives reopening on the same folder", async () => {
    const folder = await makeFolder();
    await createFileCache(folder).set("abc123", { engine: "codex", value: [1, 2] });
    const reopened = createFileCache(folder);
    expect(await reopened.get("abc123")).toEqual({ engine: "codex", value: [1, 2] });
  });

  it("leaves no temporary files behind", async () => {
    const folder = await makeFolder();
    await createFileCache(folder).set("abc123", { engine: "codex", value: 1 });
    expect(await readdir(folder)).toEqual(["abc123.json"]);
  });

  it("treats a damaged file as a miss", async () => {
    const folder = await makeFolder();
    await writeFile(join(folder, "broken.json"), "{not json", "utf8");
    await writeFile(join(folder, "wrong.json"), '{"unexpected": true}', "utf8");
    const cache = createFileCache(folder);
    expect(await cache.get("broken")).toBeUndefined();
    expect(await cache.get("wrong")).toBeUndefined();
  });
});
