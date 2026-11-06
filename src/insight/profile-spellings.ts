/**
 * What the profile says the user has, as written, for the interview plan.
 *
 * Why: the profile module's `termsOfProfile` lower-cases everything, which is right for matching but
 * not for showing "I have used RabbitMQ". This module keeps the written form, and separates "the
 * profile has the term" from "the user may use the term without asking" (confirmed and from-code
 * points, and skill rows).
 */
import { USABLE_POINT_STATUSES, type Profile } from "../shared/index.js";
import { containsTerm } from "./text-match.js";

/**
 * Every term the profile holds in a skill row or in a point that is not excluded, lower-cased term
 * to written form. Terms found only in excluded points are left out on purpose: the user said
 * never to use them, so a job asking for one is a gap to rehearse, not something the profile
 * covers. Held and ask-first terms count as held (the plan only talks about them as "profile-only").
 * Example: a skill "Kafka" gives the entry `"kafka" -> "Kafka"`.
 */
export function allProfileSpellings(profile: Profile): Map<string, string> {
  const written = new Map<string, string>();
  for (const row of profile.skills) {
    for (const item of row.items) {
      written.set(item.trim().toLowerCase(), item.trim());
    }
  }
  for (const entry of [...profile.experience, ...profile.projects]) {
    for (const point of entry.points) {
      if (point.status === "excluded") {
        continue;
      }
      for (const term of point.allowed) {
        const key = term.trim().toLowerCase();
        if (!written.has(key)) {
          written.set(key, term.trim());
        }
      }
    }
  }
  return written;
}

/**
 * The terms the user may use in an answer without asking: skill-row items and the allowed terms
 * of points whose status is usable (confirmed or from code). Written form, no duplicates.
 * Held, excluded and ask-first points never contribute.
 */
export function usableProfileTerms(profile: Profile): string[] {
  const terms = new Map<string, string>();
  for (const row of profile.skills) {
    for (const item of row.items) {
      terms.set(item.trim().toLowerCase(), item.trim());
    }
  }
  for (const entry of [...profile.experience, ...profile.projects]) {
    for (const point of entry.points) {
      if (!USABLE_POINT_STATUSES.includes(point.status)) {
        continue;
      }
      for (const term of point.allowed) {
        terms.set(term.trim().toLowerCase(), term.trim());
      }
    }
  }
  return [...terms.values()].filter((term) => term !== "");
}

/**
 * True when the profile holds `requirement`: some profile term equals it, or is a longer term that
 * contains it as a whole word ("JavaScript (ES6+)" holds "JavaScript").
 */
export function profileHolds(profileTerms: readonly string[], requirement: string): boolean {
  const wanted = requirement.trim().toLowerCase();
  return profileTerms.some((term) => term === wanted || containsTerm(term, wanted));
}
