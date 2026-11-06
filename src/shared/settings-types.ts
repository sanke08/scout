/**
 * The shape of the Settings view (Scout idea document, 5.9) and its defaults.
 *
 * The Settings view and the config file are one store: `SettingsStore` (see `ports.ts`).
 */
import { z } from "zod";

/** When Scout applies. `approve` is the default and the safest. */
export const applyModeSchema = z.enum(["approve", "auto", "prepare"]);
export type ApplyMode = z.infer<typeof applyModeSchema>;

/** How much Scout does on one job board: Prepare only, Fill I submit, or Automatic. */
export const boardLevelSchema = z.enum(["prepare", "fill", "auto"]);
export type BoardLevel = z.infer<typeof boardLevelSchema>;

export const settingsSchema = z.object({
  applyMode: applyModeSchema,
  /** Fill forms and stop before submitting until a board has a clean record. */
  dryRunFirst: z.boolean(),
  dailyApplicationLimit: z.number().int().nonnegative(),
  /** Jobs scoring below this are skipped (0 to 100). */
  minimumShortlistScore: z.number().min(0).max(100),
  /** Level per board name, e.g. { greenhouse: "fill" }. A board not listed is "prepare". */
  boardLevels: z.record(z.string(), boardLevelSchema),
  readAlertEmails: z.boolean(),
  mainEngine: z.enum(["claude", "codex"]),
  switchEngineOnLimit: z.boolean(),
  dailyModelCallBudget: z.number().int().positive(),
  digestTime: z.string().regex(/^\d{2}:\d{2}$/),
  desktopNotification: z.boolean(),
  followUpAfterDays: z.number().int().positive(),
  demographicAnswers: z.enum(["prefer-not-to-say", "ask-each-time"]),
  /** The kill switch: stops submitting and form filling now. Finding and scoring continue. */
  automationPaused: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Safe defaults: wait for approval, never automatic, nothing paused. */
export const DEFAULT_SETTINGS: Settings = {
  applyMode: "approve",
  dryRunFirst: true,
  dailyApplicationLimit: 10,
  minimumShortlistScore: 75,
  boardLevels: {},
  readAlertEmails: false,
  mainEngine: "claude",
  switchEngineOnLimit: true,
  dailyModelCallBudget: 40,
  digestTime: "08:00",
  desktopNotification: true,
  followUpAfterDays: 7,
  demographicAnswers: "prefer-not-to-say",
  automationPaused: false,
};
