/**
 * Remembering model replies so the same input is never paid for twice (idea document 5.12).
 *
 * Two implementations share one interface: in memory (tests and one run) and file-backed (stays
 * between runs). The router owns the key; a cache only stores and returns what it is given.
 */
import { join } from "node:path";
import { z } from "zod";
import { readJsonIfPresent, writeJsonAtomically } from "./atomic-json.js";

/** A stored reply: the checked value and the engine that produced it. */
export interface CachedReply {
  engine: string;
  value: unknown;
}

/** Where replies are kept, looked up by a key (a hexadecimal hash). */
export interface BrainCache {
  /** Returns the stored reply, or undefined when there is none (or it is unreadable). */
  get(key: string): Promise<CachedReply | undefined>;
  /** Stores a reply under `key`, replacing any earlier one. */
  set(key: string, reply: CachedReply): Promise<void>;
}

/** The shape of one cache file, checked when read so a damaged file counts as "no reply". */
const cachedReplySchema = z.object({ engine: z.string(), value: z.unknown() });

/**
 * A cache that lives only as long as the process.
 * Example: after `set("k", { engine: "claude", value: 1 })`, `get("k")` gives that reply.
 */
export function createMemoryCache(): BrainCache {
  const replies = new Map<string, CachedReply>();
  return {
    async get(key) {
      return replies.get(key);
    },
    async set(key, reply) {
      replies.set(key, reply);
    },
  };
}

/**
 * A cache that keeps one JSON file per key inside `folder`, written atomically.
 * Example: `createFileCache("/data/brain-cache")` stores `/data/brain-cache/<key>.json`; a new
 * cache object on the same folder (after a restart) still finds the reply.
 * A file that is missing or damaged is treated as a miss. Old files are never deleted by Scout;
 * the user may empty the folder at any time.
 */
export function createFileCache(folder: string): BrainCache {
  const fileFor = (key: string): string => join(folder, `${key}.json`);
  return {
    async get(key) {
      const parsed = cachedReplySchema.safeParse(await readJsonIfPresent(fileFor(key)));
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, reply) {
      await writeJsonAtomically(fileFor(key), reply);
    },
  };
}
