import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ScoutError, settingsSchema } from "../shared/index.js";
import { assertNotPaused, createSettingsStore } from "./settings-store.js";
import { makeTemporaryFolder } from "./test-helpers.js";

let folder: ReturnType<typeof makeTemporaryFolder>;
beforeEach(() => {
  folder = makeTemporaryFolder();
});
afterEach(() => {
  folder.remove();
});

/** Runs `work` and returns the ScoutError it throws; fails the test if nothing is thrown. */
function thrownScoutError(work: () => unknown): ScoutError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ScoutError);
    return error as ScoutError;
  }
  throw new Error("Expected a ScoutError but nothing was thrown.");
}

describe("settings store load", () => {
  it("returns the defaults when the file does not exist", () => {
    const store = createSettingsStore(join(folder.path, "settings.json"));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("fills a missing field with its default", () => {
    const path = join(folder.path, "settings.json");
    const withoutDigestTime: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete withoutDigestTime["digestTime"];
    writeFileSync(path, JSON.stringify({ ...withoutDigestTime, dailyApplicationLimit: 3 }));
    const loaded = createSettingsStore(path).load();
    expect(loaded.digestTime).toBe(DEFAULT_SETTINGS.digestTime);
    expect(loaded.dailyApplicationLimit).toBe(3);
  });

  it("treats an empty object as all defaults", () => {
    const path = join(folder.path, "settings.json");
    writeFileSync(path, "{}");
    expect(createSettingsStore(path).load()).toEqual(DEFAULT_SETTINGS);
  });

  it("refuses an unknown field and names it", () => {
    const path = join(folder.path, "settings.json");
    writeFileSync(path, JSON.stringify({ autoSubmitEverything: true }));
    const error = thrownScoutError(() => createSettingsStore(path).load());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("autoSubmitEverything");
  });

  it("refuses an invalid value and names the field", () => {
    const path = join(folder.path, "settings.json");
    writeFileSync(path, JSON.stringify({ applyMode: "yolo" }));
    const error = thrownScoutError(() => createSettingsStore(path).load());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("applyMode");
  });

  it("refuses a corrupt file that is not JSON", () => {
    const path = join(folder.path, "settings.json");
    writeFileSync(path, "{ this is not json");
    const error = thrownScoutError(() => createSettingsStore(path).load());
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain(path);
  });

  it("refuses JSON that is not an object", () => {
    const path = join(folder.path, "settings.json");
    writeFileSync(path, "[1, 2]");
    expect(thrownScoutError(() => createSettingsStore(path).load()).code).toBe("invalid-input");
  });

  it("does not hand out the shared defaults object", () => {
    const store = createSettingsStore(join(folder.path, "settings.json"));
    store.load().boardLevels["greenhouse"] = "auto";
    expect(DEFAULT_SETTINGS.boardLevels).toEqual({});
  });
});

describe("settings store save", () => {
  it("round-trips through the file and pretty-prints it", () => {
    const path = join(folder.path, "nested", "settings.json");
    const store = createSettingsStore(path);
    const changed = {
      ...DEFAULT_SETTINGS,
      dailyApplicationLimit: 4,
      boardLevels: { lever: "fill" as const },
    };
    store.save(changed);
    expect(store.load()).toEqual(changed);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("\n  ");
    expect(settingsSchema.parse(JSON.parse(text))).toEqual(changed);
  });

  it("leaves no temporary file behind", () => {
    const path = join(folder.path, "settings.json");
    createSettingsStore(path).save(DEFAULT_SETTINGS);
    expect(readdirSync(folder.path)).toEqual(["settings.json"]);
  });

  it("refuses invalid settings and keeps the old file", () => {
    const path = join(folder.path, "settings.json");
    const store = createSettingsStore(path);
    store.save({ ...DEFAULT_SETTINGS, dailyApplicationLimit: 2 });
    const bad = { ...DEFAULT_SETTINGS, dailyApplicationLimit: -1 };
    const error = thrownScoutError(() => store.save(bad));
    expect(error.code).toBe("invalid-input");
    expect(error.message).toContain("dailyApplicationLimit");
    expect(store.load().dailyApplicationLimit).toBe(2);
  });

  it("reports an unwritable location without leaving a file", () => {
    const blocker = join(folder.path, "blocker");
    writeFileSync(blocker, "a file, not a folder");
    const store = createSettingsStore(join(blocker, "settings.json"));
    expect(() => store.save(DEFAULT_SETTINGS)).toThrow();
    expect(existsSync(join(blocker, "settings.json"))).toBe(false);
  });
});

describe("assertNotPaused", () => {
  it("returns quietly when automation is running", () => {
    expect(() => assertNotPaused(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("throws paused when the kill switch is on", () => {
    const error = thrownScoutError(() =>
      assertNotPaused({ ...DEFAULT_SETTINGS, automationPaused: true }),
    );
    expect(error.code).toBe("paused");
  });
});
