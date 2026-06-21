// POST /api/import/contractors — same shape as the customers route,
// gated on `canManageContractors` instead. See sub-step 9's
// `lib/import/commit.ts` for what the orchestrator does, and the
// peer `customers/route.ts` for why the RBAC check lives here.

import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageContractors } from "@/lib/rbac";
import { runImportCommit } from "@/lib/import/commit";
import { makeContractorsCommitConfig } from "@/lib/import/entities/contractors";

export async function POST(request: NextRequest) {
  const auth = await getCurrentUserAndOrg().catch(() => null);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }
  if (!canManageContractors(auth.role)) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to import contractors." },
      { status: 403 },
    );
  }

  const supabase = createSupabaseServerClient();
  const config = makeContractorsCommitConfig(auth, supabase);
  return runImportCommit(request, config);
}
