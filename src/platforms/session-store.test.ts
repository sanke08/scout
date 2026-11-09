import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScoutError } from "../shared/index.js";
import { createSessionStore } from "./session-store.js";

const folders: string[] = [];
afterEach(() => {
  while (folders.length > 0) rmSync(folders.pop()!, { recursive: true, force: true });
});

/** A store on a fresh temporary file. */
function freshStore() {
  const folder = mkdtempSync(join(tmpdir(), "scout-sessions-"));
  folders.push(folder);
  const path = join(folder, "platform-sessions.json");
  return { path, store: createSessionStore(path) };
}

describe("the session store", () => {
  it("starts empty and gives back what was written", () => {
    const { store } = freshStore();
    expect(store.get("linkedin")).toBeUndefined();
    store.update("linkedin", {
      username: "alex@example.com",
      lastManualLoginAt: "2026-11-09T10:00:00.000Z",
    });
    expect(store.get("linkedin")).toEqual({
      username: "alex@example.com",
      lastManualLoginAt: "2026-11-09T10:00:00.000Z",
    });
  });

  it("merges updates and removes a field set to undefined", () => {
    const { store } = freshStore();
    store.update("indeed", { lastAutoLoginFailedAt: "2026-11-09T10:00:00.000Z" });
    store.update("indeed", {
      lastAutoLoginAt: "2026-11-09T11:00:00.000Z",
      lastAutoLoginFailedAt: undefined,
    });
    expect(store.get("indeed")).toEqual({ lastAutoLoginAt: "2026-11-09T11:00:00.000Z" });
  });

  it("logging out keeps the username and a recorded failure but drops the sign-in times", () => {
    const { store } = freshStore();
    store.update("naukri", {
      username: "alex@example.com",
      lastManualLoginAt: "2026-11-09T10:00:00.000Z",
      lastAutoLoginAt: "2026-11-09T10:30:00.000Z",
      lastAutoLoginFailedAt: "2026-11-09T09:00:00.000Z",
    });
    store.clearSignIns("naukri");
    expect(store.get("naukri")).toEqual({
      username: "alex@example.com",
      lastAutoLoginFailedAt: "2026-11-09T09:00:00.000Z",
    });
    store.remove("naukri");
    expect(store.get("naukri")).toBeUndefined();
  });

  it("writes atomically and never leaves a temporary file behind", () => {
    const { path, store } = freshStore();
    store.update("linkedin", { username: "alex@example.com" });
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).schemaVersion).toBe(1);
  });

  it("says in plain words when the file is damaged and does not overwrite it", () => {
    const { path, store } = freshStore();
    writeFileSync(path, "{ not json");
    expect(() => store.get("linkedin")).toThrow(ScoutError);
    expect(() => store.update("linkedin", { username: "a" })).toThrow(/damaged/);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });
});
