// POST /api/extractions/status
//
// Returns the current status + document_type for a list of file_ids.
// Used by useExtractionsPolling (client hook) — polls at 2s intervals
// while any file's status is 'processing', stops when they all move.
//
// RLS scopes to org membership; a caller can't sniff other orgs'
// extraction rows via a URL-guessed file_id.

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExtractionDocumentType,
  ExtractionStatus,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type StatusRow = {
  id: string;
  file_id: string;
  document_type: ExtractionDocumentType;
  status: ExtractionStatus;
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { file_ids?: unknown }
    | null;

  const raw = body?.file_ids;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { ok: false, error: "Expected { file_ids: string[] }" },
      { status: 400 },
    );
  }
  const fileIds = raw.filter((v): v is string => typeof v === "string").slice(0, 100);
  if (fileIds.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("file_extractions")
    .select("id, file_id, document_type, status")
    .in("file_id", fileIds)
    .returns<StatusRow[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}
