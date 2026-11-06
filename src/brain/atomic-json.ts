/**
 * Reading and writing small JSON files safely.
 *
 * Why it exists: the file-backed cache and budget must never leave a half-written file if Scout is
 * stopped mid-write. A write goes to a temporary file first and is then renamed over the target,
 * which is one step on the same disk.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes `data` as JSON to `filePath`, creating folders as needed.
 * Example: `await writeJsonAtomically("/data/cache/ab12.json", { value: 1 })`.
 * Failure means the disk refused the write; the old file, if any, is left unchanged.
 */
export async function writeJsonAtomically(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(data), "utf8");
  await rename(temporaryPath, filePath);
}

/**
 * Reads a JSON file. Returns undefined when the file does not exist or is not valid JSON, because
 * both mean "nothing usable saved here" for a cache or a counter that can start again.
 * Example: `await readJsonIfPresent("/data/cache/missing.json")` gives undefined.
 */
export async function readJsonIfPresent(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
