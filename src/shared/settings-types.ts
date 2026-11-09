/**
 * The shape of the Settings view (Scout idea document, 5.9) and its defaults.
 *
 * The Settings view and the config file are one store: `SettingsStore` (see `ports.ts`).
 */
import { z } from "zod";

/** When Scout applies. `approve` is the default and the safest. */
export const applyModeSchema = z.enum(["approve", "auto", "prepare"]);
/** The TypeScript type of one validated apply mode, inferred from its schema. */
export type ApplyMode = z.infer<typeof applyModeSchema>;

/** How much Scout does on one job board: Prepare only, Fill I submit, or Automatic. */
export const boardLevelSchema = z.enum(["prepare", "fill", "auto"]);
/** The TypeScript type of one validated board level, inferred from its schema. */
export type BoardLevel = z.infer<typeof boardLevelSchema>;

/**
 * How Scout signs in to a platform: `manual` (the user signs in in Scout's browser window and the
 * saved browser session is reused) or `saved` (Scout may type the username and password stored in
 * the OS keychain, once, when the session has expired).
 */
export const platformLoginSchema = z.enum(["manual", "saved"]);
/** The TypeScript type of one validated sign-in way, inferred from its schema. */
export type PlatformLogin = z.infer<typeof platformLoginSchema>;

/** The schema that checks one settings. Use it to validate data from files, the web page or a model. */
export const settingsSchema = z.object({
  applyMode: applyModeSchema,
  /** Fill forms and stop before submitting until a board has a clean record. */
  dryRunFirst: z.boolean(),
  dailyApplicationLimit: z.number().int().nonnegative(),
  /** Jobs scoring below this are skipped (0 to 100). */
  minimumShortlistScore: z.number().min(0).max(100),
  /** Level per board name, e.g. { greenhouse: "fill" }. A board not listed is "prepare". */
  boardLevels: z.record(z.string(), boardLevelSchema),
  /** Sign-in way per platform name, e.g. { linkedin: "saved" }. A platform not listed is "manual". */
  platformLogins: z.record(z.string(), platformLoginSchema),
  readAlertEmails: z.boolean(),
  /** Deprecated (D-013): ignored. Only Sonnet 5.5 through `claude` is used. Kept so old settings files still load. */
  mainEngine: z.enum(["claude", "codex"]),
  /** Deprecated (D-013): ignored. There is no second engine. Kept so old settings files still load. */
  switchEngineOnLimit: z.boolean(),
  /** Deprecated (D-013): ignored by autopilot, which is limited by the turn and minute settings below. */
  dailyModelCallBudget: z.number().int().positive(),
  /** The most model turns one autopilot run may use before it is stopped (1 to 200). */
  agentMaxTurns: z.number().int().min(1).max(200),
  /** The most minutes one autopilot run may last before it is stopped (1 to 240). */
  agentMaxMinutes: z.number().int().min(1).max(240),
  digestTime: z.string().regex(/^\d{2}:\d{2}$/),
  desktopNotification: z.boolean(),
  followUpAfterDays: z.number().int().positive(),
  demographicAnswers: z.enum(["prefer-not-to-say", "ask-each-time"]),
  /** The kill switch: stops submitting and form filling now. Finding and scoring continue. */
  automationPaused: z.boolean(),
});
/** The TypeScript type of one validated settings, inferred from its schema. */
export type Settings = z.infer<typeof settingsSchema>;

/** Safe defaults: wait for approval, never automatic, nothing paused. */
export const DEFAULT_SETTINGS: Settings = {
  applyMode: "approve",
  dryRunFirst: true,
  dailyApplicationLimit: 10,
  minimumShortlistScore: 75,
  boardLevels: {},
  platformLogins: {},
  readAlertEmails: false,
  mainEngine: "claude",
  switchEngineOnLimit: true,
  dailyModelCallBudget: 40,
  agentMaxTurns: 60,
  agentMaxMinutes: 45,
  digestTime: "08:00",
  desktopNotification: true,
  followUpAfterDays: 7,
  demographicAnswers: "prefer-not-to-say",
  automationPaused: false,
};
