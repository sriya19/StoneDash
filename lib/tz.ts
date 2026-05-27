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
