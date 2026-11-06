/**
 * The `Decider` port, implemented: hard rules plus keyword scoring, with no model and no I/O.
 *
 * Example: `createDecider({ blacklist: ["Scam Corp"] }).applyHardRules(posting, profile, settings)`.
 */
import type { Decider, Posting, Profile, Settings } from "../shared/index.js";
import { applyHardRules, type HardRuleContext, type HardRuleDecision } from "./hard-rules.js";
import { keywordScore } from "./keyword-score.js";

/** The decider; its hard-rule verdict also carries `notes`. */
export interface ScoutDecider extends Decider {
  applyHardRules(posting: Posting, profile: Profile, settings: Settings): HardRuleDecision;
}

/**
 * Creates a decider. `context` supplies what the profile and settings do not hold: the blacklist
 * and the recent applications for the cooldown. Omit it to run only the profile-based rules.
 */
export function createDecider(context: HardRuleContext = {}): ScoutDecider {
  return {
    applyHardRules: (posting, profile, settings) =>
      applyHardRules(posting, profile, settings, context),
    keywordScore,
  };
}
