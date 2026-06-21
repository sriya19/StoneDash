// Pure helpers shared by the customers / contractors / orders CSV
// importers. Lives outside any "use server" / "use client" module so
// both the server-side parse route and the client-side mapping UI can
// import the same code (and the same tests catch drift).

import { parse as dateFnsParse } from "date-fns";

// ---------------------------------------------------------------------------
// CSV injection sanitization
// ---------------------------------------------------------------------------
//
// Standard OWASP shape (https://owasp.org/www-community/attacks/CSV_Injection).
// If a cell starts with `=`, `+`, `-`, `@`, TAB, or CR, a downstream spreadsheet
// (Excel, Sheets, Numbers) will interpret it as a formula on re-open — which
// is how data we import becomes data that runs code in the user's spreadsheet
// later. Strip the leading offender; preserve the rest of the cell.
//
// We use `replace` rather than full-string filtering because legitimate
// cells like "+1 (555) 123-4567" or "-3.5" need to survive when they're
// NOT in the leading position (a phone number's leading `+` is unsafe).
// The rule is conservative: drop the lead char, log it, let the import
// summary tell the user how many cells we touched.

const CSV_INJECTION_LEAD_RE = /^[=+\-@\t\r]+/;

export function sanitizeCell(raw: string): { value: string; sanitized: boolean } {
  if (!raw) return { value: raw, sanitized: false };
  if (!CSV_INJECTION_LEAD_RE.test(raw)) return { value: raw, sanitized: false };
  return { value: raw.replace(CSV_INJECTION_LEAD_RE, ""), sanitized: true };
}

// ---------------------------------------------------------------------------
// Flexible date parsing
// ---------------------------------------------------------------------------
//
// Real CSVs from QuickBooks, Excel exports, and hand-rolled shop
// spreadsheets vary wildly. Try each pattern in order; the first that
// parses cleanly wins. Returns the ISO yyyy-MM-dd string when one of
// the formats matches, null when none do. Caller decides whether a
// null is a row-level error or a skip.
//
// Order matters: more specific formats first so e.g. "2026-06-21" hits
// ISO before falling through to the slash patterns. Two-digit-year
// patterns last so "2026" is never mis-parsed as a yy that becomes
// 1920 / 2026 ambiguous.

const DATE_PATTERNS = [
  "yyyy-MM-dd",
  "MM/dd/yyyy",
  "M/d/yyyy",
  "MMM d, yyyy",
  "MMMM d, yyyy",
  "MM/dd/yy",
  "M/d/yy",
] as const;

export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Use a fixed reference date so any partial parse doesn't pull
  // "today" into the result — we only accept patterns that produce a
  // fully-specified date.
  const reference = new Date(2000, 0, 1);

  for (const pattern of DATE_PATTERNS) {
    const parsed = dateFnsParse(trimmed, pattern, reference);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Header normalization + matching
// ---------------------------------------------------------------------------
//
// A "Customer Name" header from QuickBooks, a "customer_name" header
// from a Postgres export, and a "Customer  Name" with a typo'd double
// space should all map to the same canonical field. Normalize to
// lowercase / underscored / single-spaced so the auto-mapping step in
// each entity importer can hit a high-confidence match without making
// the user re-type the column names.

export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Try to auto-match each parsed header to a canonical field name. The
// `aliases` map declares: canonical field → list of acceptable header
// aliases (already normalized via normalizeHeader). Returns a record
// mapping the original header → canonical field, or undefined when no
// alias matches (caller can prompt the user to pick manually).
export function autoMapHeaders<TField extends string>(
  parsedHeaders: string[],
  aliases: Record<TField, readonly string[]>,
): Record<string, TField | undefined> {
  const fieldEntries = Object.entries(aliases) as [TField, readonly string[]][];
  const out: Record<string, TField | undefined> = {};
  const usedFields = new Set<TField>();

  for (const header of parsedHeaders) {
    const normalized = normalizeHeader(header);
    const match = fieldEntries.find(
      ([field, aliasList]) =>
        !usedFields.has(field) && aliasList.includes(normalized),
    );
    if (match) {
      out[header] = match[0];
      usedFields.add(match[0]);
    } else {
      out[header] = undefined;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Trim + null helpers
// ---------------------------------------------------------------------------

// Trim, sanitize, and return null for the empty string. The most common
// transform every entity importer needs for non-required text fields.
export function cleanCell(raw: string | undefined | null): {
  value: string | null;
  sanitized: boolean;
} {
  if (raw == null) return { value: null, sanitized: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, sanitized: false };
  const result = sanitizeCell(trimmed);
  return { value: result.value === "" ? null : result.value, sanitized: result.sanitized };
}
