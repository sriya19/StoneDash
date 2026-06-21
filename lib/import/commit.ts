// Shared scaffolding for the per-entity commit routes (sub-steps 10-12
// each ship their own `/api/import/<entity>` route). Each entity owns
// its own row → DB-record transform; this module handles everything
// that's the same across them: multipart parsing, mapping JSON shape,
// chunked insert orchestration, summary aggregation.

import Papa from "papaparse";
import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { sanitizeCell } from "./helpers";

const MAX_BYTES = 5 * 1024 * 1024; // mirror the parse route
const CHUNK_SIZE = 100; // PLAN Q2 lock: 100-row transactional chunks

export type RowMapping<TField extends string> = Record<string, TField | "">;

export type RowError = {
  row: number; // 1-indexed within the CSV (data rows, not counting header)
  message: string;
};

// What each entity-specific commit returns to the orchestrator. The
// orchestrator aggregates these into the final response shape the
// client consumes via <CsvImportSheet>.
export type CommitChunkResult = {
  inserted: number;
  skipped: number;
  warnings: string[];
};

// The per-entity insert handler. Receives a chunk of already-mapped
// rows (each row is `{ canonicalField: rawValue }`) and returns the
// chunk result. The handler owns its own validation + Supabase calls.
//
// Why we hand the handler "already-mapped" rows instead of raw CSV
// rows: the orchestrator applies the user's column mapping uniformly
// (and sanitizes the values), so each entity handler stays focused on
// "given a list of customer fields, insert customers" without
// re-implementing the mapping plumbing.
export type EntityCommitHandler<TField extends string> = (
  chunk: Array<Partial<Record<TField, string>>>,
  // Where each chunk row sits in the original CSV (1-indexed, data
  // rows only). Lets handlers attach the right row number to any
  // validation warning they produce.
  rowOffsets: number[],
) => Promise<CommitChunkResult>;

// Per-entity config the orchestrator needs in addition to the handler.
export type EntityCommitConfig<TField extends string> = {
  // The canonical field set for this entity. Used to validate the
  // mapping JSON the client sends (so a malicious or buggy client
  // can't smuggle an unknown field through).
  allFields: readonly TField[];
  requiredFields: readonly TField[];
  handler: EntityCommitHandler<TField>;
};

// One-shot entry point each entity route calls. Handles auth, file
// parsing, mapping validation, chunking, and response shape — so each
// per-entity route is just `return runImportCommit(request, config)`.
export async function runImportCommit<TField extends string>(
  request: NextRequest,
  config: EntityCommitConfig<TField>,
): Promise<NextResponse> {
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
  const mappingRaw = formData.get("mapping");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    );
  }
  if (typeof mappingRaw !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing 'mapping' field" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  let mapping: RowMapping<TField>;
  try {
    const parsed = JSON.parse(mappingRaw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("mapping must be an object");
    }
    const allowed = new Set<string>(config.allFields);
    const validated: RowMapping<TField> = {};
    for (const [csvHeader, target] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (target === "" || target == null) {
        validated[csvHeader] = "";
        continue;
      }
      if (typeof target !== "string" || !allowed.has(target)) {
        throw new Error(`Unknown target field: ${String(target)}`);
      }
      validated[csvHeader] = target as TField;
    }
    mapping = validated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid mapping JSON";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // Re-validate required fields server-side. The client UI also
  // enforces this, but never trust a client gate alone.
  const mappedFields = new Set(Object.values(mapping).filter((v) => v !== ""));
  const missing = config.requiredFields.filter((f) => !mappedFields.has(f));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Missing required mapping for: ${missing.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    return NextResponse.json(
      { ok: false, error: `Parse error at row ${first.row}: ${first.message}` },
      { status: 400 },
    );
  }

  const rawRows = parsed.data;
  if (rawRows.length === 0) {
    return NextResponse.json({ ok: false, error: "CSV has no rows" }, { status: 400 });
  }

  // Apply mapping + sanitize. After this each row is keyed by canonical
  // field, not by the CSV's original headers. The entity handler can
  // then code against a stable shape.
  const mappedRows: Array<Partial<Record<TField, string>>> = rawRows.map((raw) => {
    const out: Partial<Record<TField, string>> = {};
    for (const [csvHeader, target] of Object.entries(mapping)) {
      if (target === "") continue;
      const result = sanitizeCell(raw[csvHeader] ?? "");
      out[target as TField] = result.value;
    }
    return out;
  });

  // Chunked insert. Per PLAN Q2: 100 rows per chunk so a single bad
  // row doesn't blow up a 5000-row import — the handler reports
  // per-chunk inserted/skipped/warnings, the orchestrator aggregates.
  let inserted = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (let i = 0; i < mappedRows.length; i += CHUNK_SIZE) {
    const chunk = mappedRows.slice(i, i + CHUNK_SIZE);
    const offsets = chunk.map((_, idx) => i + idx + 1); // 1-indexed data row
    const result = await config.handler(chunk, offsets);
    inserted += result.inserted;
    skipped += result.skipped;
    for (const w of result.warnings) warnings.push(w);
  }

  return NextResponse.json({ ok: true, inserted, skipped, warnings });
}
