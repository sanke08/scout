/**
 * Hard rules: the cheap, model-free filters that decide whether a posting is worth any further
 * work (Scout idea document, 5.6, step 1).
 *
 * Every rule runs, in order, and EVERY reason is collected, so the user sees all the reasons a
 * posting was dropped and not only the first. A posting is kept only when no rule objected.
 * Rules that kept the posting but have something to say contribute `notes`.
 *
 * Example: a senior, on-site-in-Paris posting for a junior Berlin profile returns
 * `{ keep: false, reasons: ["The job is onsite in ...", "The job is senior level ..."], notes: [] }`.
 */
import type { HardRuleVerdict, Posting, Profile, Settings } from "../shared/index.js";
import { isInCooldown, type AppliedApplication } from "./cooldown.js";
import { NO_OBJECTION, type RuleOutcome } from "./rule-outcome.js";
import { checkWorkAuthorization } from "./rule-authorization.js";
import {
  checkBlacklist,
  checkExcludedCompanies,
  checkExcludedIndustries,
} from "./rule-companies.js";
import { checkDealbreakers } from "./rule-dealbreakers.js";
import { checkExperience } from "./rule-experience.js";
import { checkFlags } from "./rule-flags.js";
import { checkLocation } from "./rule-location.js";
import { checkSalary } from "./rule-salary.js";
import { checkSeniority } from "./rule-seniority.js";

/**
 * The verdict of the hard rules: the shared verdict plus `notes`, things worth showing the user
 * about a posting that was kept (a possible ghost job, a salary that could not be compared).
 */
export interface HardRuleDecision extends HardRuleVerdict {
  notes: string[];
}

/** Recent applications and the cooldown length, for the cooldown rule. */
export interface CooldownContext {
  applications: readonly AppliedApplication[];
  days: number;
  now: Date;
}

/**
 * Information the hard rules need that is not in the profile or settings. All parts are optional:
 * a missing part switches that rule off.
 *
 * Example: `{ blacklist: ["Scam Corp"], cooldown: { applications, days: 14, now } }`.
 */
export interface HardRuleContext {
  /** Company names the user never wants. */
  blacklist?: readonly string[];
  cooldown?: CooldownContext;
}

/** The cooldown rule as a `RuleOutcome`, so it can be listed with the others. */
function checkCooldown(posting: Posting, cooldown: CooldownContext | undefined): RuleOutcome {
  if (cooldown === undefined) return NO_OBJECTION;
  if (!isInCooldown(posting.company, cooldown.applications, cooldown.now, cooldown.days)) {
    return NO_OBJECTION;
  }
  return {
    reason: `You applied to "${posting.company}" within the last ${cooldown.days} days, so it is in cooldown.`,
  };
}

/**
 * Runs every hard rule on `posting` and collects all reasons and notes.
 *
 * `settings` is part of the shared `Decider` signature; no rule reads it today, because every
 * limit a rule needs lives in the profile preferences or in `context`.
 */
export function applyHardRules(
  posting: Posting,
  profile: Profile,
  _settings: Settings,
  context: HardRuleContext = {},
): HardRuleDecision {
  const outcomes: RuleOutcome[] = [
    checkFlags(posting),
    checkBlacklist(posting, context.blacklist ?? []),
    checkExcludedCompanies(posting, profile),
    checkCooldown(posting, context.cooldown),
    checkLocation(posting, profile),
    checkSalary(posting, profile),
    checkSeniority(posting, profile),
    checkExperience(posting, profile),
    checkExcludedIndustries(posting, profile),
    checkWorkAuthorization(posting, profile),
    checkDealbreakers(posting, profile),
  ];

  const reasons: string[] = [];
  const notes: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.reason !== undefined) reasons.push(outcome.reason);
    if (outcome.note !== undefined) notes.push(outcome.note);
  }
  return { keep: reasons.length === 0, reasons, notes };
}
