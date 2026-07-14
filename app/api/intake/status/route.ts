// POST /api/intake/status
//
// Returns the current status for a list of intake_ids. Used by
// the /intake page's client hook — polls every 2s while any row
// is 'processing', stops when they all move. Same shape as Task
// 5's /api/extractions/status.

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AiIntakeStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type StatusRow = { id: string; status: AiIntakeStatus };

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { intake_ids?: unknown }
    | null;

  const raw = body?.intake_ids;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { ok: false, error: "Expected { intake_ids: string[] }" },
      { status: 400 },
    );
  }
  const ids = raw.filter((v): v is string => typeof v === "string").slice(0, 100);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ai_intake_events")
    .select("id, status")
    .in("id", ids)
    .returns<StatusRow[]>();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: data ?? [] });
}
