// POST /api/import/parse
//
// Why a route handler instead of a Server Action: Next 14 Server
// Actions cap request bodies at 1MB, and the CSV import targets shop
// owners pushing QuickBooks / Excel exports that routinely run 2-5MB.
// A route handler gives us the 5MB ceiling we promised in PLAN Q2
// without disabling Server Action protections globally.
//
// Body: multipart/form-data with a single `file` field.
// Returns:
//   { ok: true, headers, rows: rows.slice(0, 10), totalRows, sanitizedCells }
// or
//   { ok: false, error }
//
// The route does NOT write to the database. It only:
//   (a) verifies the caller is signed in (RLS gate parity with the rest
//       of the app — even though no writes happen, we don't want
//       random callers parsing files through the server),
//   (b) parses the CSV with papaparse,
//   (c) returns the first 10 rows + the total count so the UI can show
//       a preview before the user commits to ingesting.
//
// The actual insert happens in a separate Server Action (`commitImport`,
// per-entity in sub-steps 10/11/12) so the parse is cheap, idempotent,
// and re-runnable while the user picks column mappings.

import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { sanitizeCell } from "@/lib/import/helpers";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const PREVIEW_ROWS = 10;

type ParsedRow = Record<string, string>;

export async function POST(request: NextRequest) {
  // Auth-gate the parse endpoint. We don't need the org/role for the
  // parse itself — just confirm the caller has a session, same as any
  // other authenticated surface.
  try {
    await getCurrentUserAndOrg();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { ok: false, error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`,
      },
      { status: 413 },
    );
  }

  const text = await file.text();

  // papaparse with header:true gives us { data: Record<string,string>[],
  // meta: { fields: string[] } }. skipEmptyLines drops trailing blank
  // rows (Excel loves to leave one). dynamicTyping is OFF — we want
  // every cell as string and let the entity importer coerce, so the
  // sanitizer sees the raw input.
  const parsed = Papa.parse<ParsedRow>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    return NextResponse.json(
      {
        ok: false,
        error: `Parse error at row ${first.row}: ${first.message}`,
      },
      { status: 400 },
    );
  }

  const headers = parsed.meta.fields ?? [];
  const rawRows = parsed.data;

  if (headers.length === 0 || rawRows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "CSV contains no rows" },
      { status: 400 },
    );
  }

  // Sanitize ALL rows up-front (not just the preview slice). The commit
  // action will re-fetch the file or trust the caller-provided rows;
  // either way we want a single counted sanitization pass so the user
  // sees an honest summary on the preview screen.
  let sanitizedCells = 0;
  const sanitizedRows: ParsedRow[] = rawRows.map((row) => {
    const out: ParsedRow = {};
    for (const header of headers) {
      const raw = row[header] ?? "";
      const result = sanitizeCell(raw);
      if (result.sanitized) sanitizedCells += 1;
      out[header] = result.value;
    }
    return out;
  });

  return NextResponse.json({
    ok: true,
    headers,
    rows: sanitizedRows.slice(0, PREVIEW_ROWS),
    totalRows: sanitizedRows.length,
    sanitizedCells,
  });
}
