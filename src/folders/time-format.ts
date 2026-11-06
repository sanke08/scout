/**
 * Small, deterministic date formatters used by every file in this module.
 *
 * Why they exist: Scout writes absolute dates everywhere (never "yesterday") and always in UTC,
 * so a folder, a log line and a backup made at the same moment agree no matter the time zone.
 *
 * Example: for `new Date("2026-11-07T14:03:09Z")`, `isoDate` gives `2026-11-07`, `logStamp` gives
 * `2026-11-07 14:03 UTC` and `backupStamp` gives `2026-11-07_140309`.
 * Failure: an invalid `Date` makes `toISOString` throw a `RangeError`; callers pass real clocks.
 */

/** The UTC calendar date as `YYYY-MM-DD`. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC date and minute as `YYYY-MM-DD HH:MM UTC`, used at the start of a log line. */
export function logStamp(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/** The UTC date and second as `YYYY-MM-DD_HHMMSS`, used in backup folder names. */
export function backupStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replaceAll(":", "")}`;
}
