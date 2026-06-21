// POST /api/import/customers — entity-specific commit endpoint.
//
// The body shape (multipart with `file` + `mapping` JSON) and the
// response shape (`{ ok, inserted, skipped, warnings }` or `{ ok: false,
// error }`) are owned by `runImportCommit` so the client dialog can
// treat every entity import identically. The only per-entity surface
// is the field set + the insert handler.

import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canManageCustomers } from "@/lib/rbac";
import { runImportCommit } from "@/lib/import/commit";
import { makeCustomersCommitConfig } from "@/lib/import/entities/customers";

export async function POST(request: NextRequest) {
  // Customers import requires the customer-management permission. We
  // check here (not inside the orchestrator) because the orchestrator
  // is per-entity-blind and each entity has its own RBAC gate.
  const auth = await getCurrentUserAndOrg().catch(() => null);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Not authenticated" },
      { status: 401 },
    );
  }
  if (!canManageCustomers(auth.role)) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to import customers." },
      { status: 403 },
    );
  }

  const supabase = createSupabaseServerClient();
  const config = makeCustomersCommitConfig(auth, supabase);
  return runImportCommit(request, config);
}
