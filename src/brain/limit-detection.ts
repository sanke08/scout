/**
 * Recognising a "usage limit reached" message in what an engine printed, and when it resets.
 *
 * Why it exists: Claude Code and Codex run on the user's subscription. When the limit is hit Scout
 * must stop calling that engine until the reset time (Scenario K) instead of failing blindly.
 *
 * ASSUMPTION WARNING: the wording of these messages comes from memory of how the tools report a
 * limit. The patterns are listed in one place so the owner can add the exact phrases they see.
 */

/** Result of looking for a limit message. `resetAt` is an ISO timestamp, present only when known. */
export interface LimitDetection {
  limited: boolean;
  resetAt?: string;
}

/** Phrases that mean "you cannot call the model right now". Matching is case-insensitive. */
const LIMIT_PHRASES: RegExp[] = [
  /usage limit/i,
  /rate limit/i,
  /limit (?:has been |was )?reached/i,
  /(?:hit|reached|exceeded) (?:your|the) (?:\w+ )?limit/i,
  /limit will reset/i,
  /quota (?:exceeded|reached)/i,
  /too many requests/i,
];

const MILLISECONDS_PER_UNIT: Record<string, number> = {
  day: 86_400_000,
  hour: 3_600_000,
  hr: 3_600_000,
  minute: 60_000,
  min: 60_000,
  second: 1000,
  sec: 1000,
};

/** Old Claude Code format: "Claude AI usage limit reached|1760000000" (seconds since 1970). */
function resetFromEpochSeconds(text: string): Date | undefined {
  const match = /limit reached\|(\d{10})\b/i.exec(text);
  return match ? new Date(Number(match[1]) * 1000) : undefined;
}

/** A full timestamp after the word "reset", e.g. "will reset at 2026-11-07T15:00:00Z". */
function resetFromTimestamp(text: string): Date | undefined {
  const match =
    /reset\w*\s*(?:at|on)?\s*:?\s*(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(text);
  if (!match) return undefined;
  const parsed = new Date(match[1]!);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** A wait after "resets in" or "try again in", e.g. "resets in 2 hours" or "in 1 hour 30 minutes". */
function resetFromRelativeWait(text: string, now: Date): Date | undefined {
  const phrase =
    /(?:reset\w*|try again|retry|available again)\s+in\s+((?:\d+(?:\.\d+)?\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)(?:\s*(?:and|,)?\s*)?)+)/i.exec(
      text,
    );
  if (!phrase) return undefined;
  let waitMilliseconds = 0;
  for (const part of phrase[1]!.matchAll(
    /(\d+(?:\.\d+)?)\s*(day|hour|hr|minute|min|second|sec)/gi,
  )) {
    waitMilliseconds += Number(part[1]) * MILLISECONDS_PER_UNIT[part[2]!.toLowerCase()]!;
  }
  return new Date(now.getTime() + waitMilliseconds);
}

/**
 * A clock time after "reset", e.g. "resets at 3pm" or "reset at 15:30". The time is read in the
 * computer's own time zone and means the next time that clock shows it.
 */
function resetFromClockTime(text: string, now: Date): Date | undefined {
  const match = /reset\w*\s*(?:at)?\s*(?:(\d{1,2}):(\d{2})\s*(am|pm)?|(\d{1,2})\s*(am|pm))/i.exec(
    text,
  );
  if (!match) return undefined;
  let hour = Number(match[1] ?? match[4]);
  const minute = Number(match[2] ?? 0);
  const meridiem = (match[3] ?? match[5])?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

/**
 * Looks at both output streams of an engine and says whether a usage limit was reported.
 *
 * Example: `detectLimit("Usage limit reached. Your limit will reset at 3pm.", "", now)` gives
 * `{ limited: true, resetAt: "<next 3pm in local time, as ISO>" }`.
 * Example: `detectLimit("Here is your JSON", "")` gives `{ limited: false }`.
 * `now` is the clock used for relative times such as "resets in 2 hours"; tests pass a fixed one.
 */
export function detectLimit(
  stdout: string,
  stderr: string,
  now: Date = new Date(),
): LimitDetection {
  const text = `${stdout}\n${stderr}`;
  if (!LIMIT_PHRASES.some((phrase) => phrase.test(text))) return { limited: false };
  const resetAt =
    resetFromEpochSeconds(text) ??
    resetFromTimestamp(text) ??
    resetFromRelativeWait(text, now) ??
    resetFromClockTime(text, now);
  return resetAt ? { limited: true, resetAt: resetAt.toISOString() } : { limited: true };
}
