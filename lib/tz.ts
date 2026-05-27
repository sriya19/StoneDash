// Server-side timezone discipline (see DEVLOG header note).
//
// All DB-side comparisons and indexes operate on UTC timestamptz. Conversion
// to org-local representation happens here, exclusively in code paths that
// produce strings for rendering (or strings to be passed back into a render
// component). The input boundary — parsing a user-picked "2026-05-12 10:00"
// in the org's tz into a UTC Date — also lives in this module.
//
// Anything that reads or writes timestamptz outside of these helpers is a
// code smell. Use these wrappers so the rule is consistent.

import { format } from "date-fns";
import { TZDate, tz } from "@date-fns/tz";

/**
 * Format a UTC timestamp (or anything Date-coercible) using a date-fns
 * format string, rendered in the supplied IANA tz.
 *
 * Example:
 *   formatInTimeZone("2026-05-12T14:00:00Z", "America/New_York", "EEE, MMM d, h:mm a")
 *   // "Tue, May 12, 10:00 AM"
 */
export function formatInTimeZone(
  value: Date | string | number,
  timeZone: string,
  fmt: string,
): string {
  const d = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  return format(d, fmt, { in: tz(timeZone) });
}

/**
 * Return the calendar date (YYYY-MM-DD) of `value` in the target tz.
 * Used wherever we previously read a `date` column directly.
 */
export function dateInTimeZone(
  value: Date | string | number | null | undefined,
  timeZone: string,
): string | null {
  if (value === null || value === undefined) return null;
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd");
}

/**
 * Parse "YYYY-MM-DD" + "HH:mm[:ss]" in the target tz, return a UTC Date.
 *
 * The user picks "10:00 on May 12" intending that to mean 10 AM in the org's
 * tz. This converts that intent to the underlying UTC moment for storage.
 */
export function parseLocalDateTime(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const seconds = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  // TZDate parses an ISO-shaped string as wall-clock in the supplied tz.
  const tzd = new TZDate(`${dateStr}T${seconds}`, timeZone);
  return new Date(tzd.getTime());
}

/**
 * Returns the short timezone abbreviation (e.g. "EDT", "PST") for the
 * supplied IANA tz at the current moment. Uses Intl directly because
 * date-fns' "z*" format tokens render long names like "Eastern Daylight Time",
 * which is too wide for the schedule header.
 */
export function tzAbbreviation(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Returns a UTC Date representing "Sunday 00:00 in the org tz" for the
 * week the supplied moment falls into. Used by the calendar week view to
 * compute the visible range.
 */
export function startOfWeekInTz(forDate: Date, timeZone: string): Date {
  // Get the org-local YYYY-MM-DD for the input moment, then walk back to
  // the most recent Sunday. The round-trip through a date string lets us
  // ignore DST + offset noise.
  const localDateStr = formatInTimeZone(forDate, timeZone, "yyyy-MM-dd");
  // localDateStr is "YYYY-MM-DD". Construct a Date at UTC midnight so
  // getUTCDay() returns the day-of-week of THAT calendar date, not the
  // input moment's UTC day.
  const localMidnight = new Date(`${localDateStr}T00:00:00Z`);
  const dow = localMidnight.getUTCDay(); // 0 = Sun
  const sundayMs = localMidnight.getTime() - dow * 24 * 60 * 60 * 1000;
  const sundayDateStr = new Date(sundayMs).toISOString().slice(0, 10);
  return parseLocalDateTime(sundayDateStr, "00:00", timeZone);
}

/**
 * Same-UTC-day check used by the DB CHECK on order_events and by client-
 * side dialog validators. Two timestamps fall on the same UTC calendar day.
 */
export function sameUtcDay(a: Date | string | number, b: Date | string | number): boolean {
  const da = typeof a === "string" || typeof a === "number" ? new Date(a) : a;
  const db = typeof b === "string" || typeof b === "number" ? new Date(b) : b;
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}
