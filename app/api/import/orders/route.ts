// POST /api/import/orders — gated on `canCreateOrder` (manager+).

import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canCreateOrder } from "@/lib/rbac";
import { runImportCommit } from "@/lib/import/commit";
import { makeOrdersCommitConfig } from "@/lib/import/entities/orders";

export async function POST(request: NextRequest) {
  const auth = await getCurrentUserAndOrg().catch(() => null);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }
  if (!canCreateOrder(auth.role)) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to import orders." },
      { status: 403 },
    );
  }

  const supabase = createSupabaseServerClient();
  const config = makeOrdersCommitConfig(auth, supabase);
  return runImportCommit(request, config);
}
