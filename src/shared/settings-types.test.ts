/** Tests that settings files written before autopilot still load, and the new limits are checked. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore } from "../store/index.js";
import { DEFAULT_SETTINGS, settingsSchema } from "./settings-types.js";

describe("settings", () => {
  it("loads an old settings file that has the engine fields and no agent limits", () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-settings-"));
    try {
      const path = join(directory, "settings.json");
      writeFileSync(
        path,
        JSON.stringify({
          mainEngine: "codex",
          switchEngineOnLimit: false,
          dailyModelCallBudget: 12,
          dailyApplicationLimit: 3,
        }),
      );
      const loaded = createSettingsStore(path).load();
      expect(loaded.dailyApplicationLimit).toBe(3);
      expect(loaded.agentMaxTurns).toBe(60);
      expect(loaded.agentMaxMinutes).toBe(45);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the agent limits inside their ranges", () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, agentMaxTurns: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, agentMaxTurns: 201 }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, agentMaxMinutes: 241 }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, agentMaxMinutes: 1.5 }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe("the approved reference page", () => {
  it("offers no Codex engine, because autopilot uses Claude only (old settings files still load)", () => {
    const page = readFileSync(
      join(import.meta.dirname, "..", "web", "reference", "scout-page.html"),
      "utf8",
    );
    expect(page).not.toMatch(/codex/i);
    expect(settingsSchema.parse({ ...DEFAULT_SETTINGS, mainEngine: "codex" }).mainEngine).toBe(
      "codex",
    );
  });
});
