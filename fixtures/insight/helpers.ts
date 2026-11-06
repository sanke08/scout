/**
 * Helpers shared by the insight tests: the fixture repository, a scratch folder and a valid
 * recorded note reply. Test-only, so it lives with the fixtures and is never built.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import type { ProjectNoteReply } from "../../src/insight/note-schema.js";

/** The folder holding the fictional sample repository and its recorded reply. */
const FIXTURE_FOLDER = fileURLToPath(new URL("./", import.meta.url));

/** Scratch folders made by `makeScratchFolder`, removed after every test. */
const scratchFolders: string[] = [];

afterEach(() => {
  for (const folder of scratchFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Makes an empty scratch folder that is removed after the test. */
export function makeScratchFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "scout-insight-"));
  scratchFolders.push(folder);
  return folder;
}

/** Copies the sample repository into a new scratch folder and returns the copy's path. */
export function copySampleRepository(): string {
  const parent = makeScratchFolder();
  const copy = join(parent, "pocket-queue");
  cpSync(join(FIXTURE_FOLDER, "pocket-queue"), copy, { recursive: true });
  return copy;
}

/** The note reply a model is recorded to give for the sample repository. */
export function sampleNoteReply(): ProjectNoteReply {
  return JSON.parse(
    readFileSync(join(FIXTURE_FOLDER, "pocket-queue-reply.json"), "utf8"),
  ) as ProjectNoteReply;
}
