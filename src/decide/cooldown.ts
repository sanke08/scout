/**
 * Cooldown: do not apply again to a company soon after the last application.
 *
 * Why: two applications to one company in a short time look careless and can hurt both.
 *
 * Example: applied to "Harbor Systems" on 2026-11-01, `now` is 2026-11-05, cooldown 14 days:
 * `isInCooldown("harbor systems", applications, now, 14)` is `true`.
 */
import { normaliseText } from "./text-match.js";

/** One application already made: which company and when (ISO timestamp). */
export interface AppliedApplication {
  company: string;
  appliedAt: string;
}

/** Milliseconds in one day. */
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * True when `applications` holds an application to `company` made less than `days` days before
 * `now`. Company names are compared ignoring case and spacing. An application dated in the
 * future counts as in cooldown (the safe reading). Entries with an unreadable date are ignored.
 */
export function isInCooldown(
  company: string,
  applications: readonly AppliedApplication[],
  now: Date,
  days: number,
): boolean {
  const wanted = normaliseText(company);
  for (const application of applications) {
    if (normaliseText(application.company) !== wanted) continue;
    const appliedTime = Date.parse(application.appliedAt);
    if (Number.isNaN(appliedTime)) continue;
    if (now.getTime() - appliedTime < days * DAY_MILLISECONDS) return true;
  }
  return false;
}
