// POST /api/extract/[fileId]
//
// The internal extraction endpoint. Called by `kickOffExtraction()`
// (server action) fire-and-forget with an HMAC-signed
// `Authorization: Internal <token>` header. Runs the two-step
// pipeline and writes the result back into `file_extractions`.
//
// This route:
//   1. Verifies the HMAC-signed internal token binds to :fileId.
//   2. Loads the attachment row via the service-role client (the
//      internal call has no user session).
//   3. Downloads the file bytes from Supabase Storage.
//   4. If mime is a supported image or PDF: runs the pipeline.
//      If MOCK_AI=1 or ?mode=mock: returns a canned
//      response without calling OpenAI (used by smoke).
//      If mime is anything else: writes status='review',
//      document_type='other', fields={}. No LLM call.
//   5. Writes the result to `file_extractions` (UPDATE by file_id,
//      not INSERT — the row was created up-front by
//      registerAttachment in sub-step 4).
//   6. On any failure, writes status='failed' + error_message.
//
// The route never blocks longer than the extraction pipeline itself;
// concurrency + throughput are bounded by the caller (one fetch per
// upload) rather than by this handler.

import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyInternalToken } from "@/lib/extraction/internal-token";
import { mockExtraction } from "@/lib/extraction/mock";
import {
  runExtractionPipeline,
  toDataUrl,
} from "@/lib/extraction/pipeline";
import type { ExtractionResult } from "@/lib/extraction/types";
import { isMockAi } from "@/lib/env/mock-guard";

// Supported input mimes. Anything else short-circuits to
// `document_type='other'` without an LLM call.
const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
const PDF_MIME = "application/pdf";

type AttachmentRow = {
  id: string;
  org_id: string;
  storage_path: string;
  mime: string | null;
};

function isMockMode(request: NextRequest): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "mock") return true;
  // Same env-var name the brief called out. Read on the SERVER —
  // the NEXT_PUBLIC_ prefix is misleading here but keeping the
  // brief's name makes the flag memorable.
  if (isMockAi()) return true;
  return false;
}

async function writeFailed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  fileId: string,
  errorMessage: string,
): Promise<void> {
  await admin
    .from("file_extractions")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("file_id", fileId);
}

async function writeResult(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  fileId: string,
  result: ExtractionResult,
): Promise<void> {
  await admin
    .from("file_extractions")
    .update({
      status: "review",
      document_type: result.document_type,
      confidence: result.confidence,
      extracted_fields: result.fields,
      raw_response: result.raw,
      cost_cents: result.cost_cents,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("file_id", fileId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { fileId: string } },
) {
  const fileId = params.fileId;
  if (typeof fileId !== "string" || fileId.length === 0) {
    return NextResponse.json({ ok: false, error: "Missing fileId" }, { status: 400 });
  }

  // 1. Auth via HMAC internal token. `Authorization: Internal <tok>`.
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Internal ")
    ? authHeader.slice("Internal ".length)
    : null;
  const verify = verifyInternalToken(token, fileId);
  if (!verify.ok) {
    return NextResponse.json({ ok: false, error: verify.error }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // 2. Load the attachment row.
  const { data: file, error: fileErr } = await admin
    .from("order_attachments")
    .select("id, org_id, storage_path, mime")
    .eq("id", fileId)
    .maybeSingle<AttachmentRow>();
  if (fileErr || !file) {
    return NextResponse.json(
      { ok: false, error: fileErr?.message ?? "File not found" },
      { status: 404 },
    );
  }

  // Mock mode short-circuit. Used by the smoke script + local dev
  // when OPENAI_API_KEY isn't set. Writes a canned result that
  // shape-matches a real extraction.
  if (isMockMode(request)) {
    const result = mockExtraction();
    await writeResult(admin, fileId, result);
    return NextResponse.json({ ok: true, mocked: true });
  }

  const mime = (file.mime ?? "").toLowerCase();
  const isImage = IMAGE_MIMES.has(mime);
  const isPdf = mime === PDF_MIME;

  // 3. Unsupported mime — short-circuit to `other` with no LLM call.
  if (!isImage && !isPdf) {
    await writeResult(admin, fileId, {
      document_type: "other",
      confidence: "low",
      fields: {},
      raw: { skipped: true, reason: `unsupported mime: ${mime || "unknown"}` },
      cost_cents: 0,
    });
    return NextResponse.json({ ok: true, skipped: true });
  }

  // 4. Download the file bytes.
  const { data: blob, error: dlErr } = await admin.storage
    .from("order-files")
    .download(file.storage_path);
  if (dlErr || !blob) {
    await writeFailed(admin, fileId, dlErr?.message ?? "Storage download failed");
    return NextResponse.json(
      { ok: false, error: dlErr?.message ?? "Storage download failed" },
      { status: 500 },
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = toDataUrl(bytes, mime);

  // 5. Run the pipeline. Any thrown error becomes status='failed'.
  try {
    const result = await runExtractionPipeline(dataUrl);
    await writeResult(admin, fileId, result);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeFailed(admin, fileId, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
