"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mintInternalToken } from "@/lib/extraction/internal-token";
import { hasAtLeast } from "@/lib/rbac";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// insertIntakeRow — synchronous companion to a screenshot upload
// ---------------------------------------------------------------------------
//
// Same Q7 pattern as Task 5: the row lands with status='processing'
// in the same request as the storage upload so the /intake list's
// spinner chip renders on first refresh, no half-second gap.

export async function insertIntakeRow(input: {
  storagePath: string;
}): Promise<ActionResult<{ id: string }>> {
  const { userId, org, role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can upload intake screenshots" };
  }
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_intake_events")
    .insert({
      org_id: org.id,
      uploaded_by: userId,
      storage_path: input.storagePath,
      status: "processing",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not insert intake" };
  }

  revalidatePath("/intake");
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// kickOffIntake — fire-and-forget POST to /api/intake/[intakeId]
// ---------------------------------------------------------------------------
//
// Mirrors Task 5's kickOffExtraction. Signed HMAC token verifies
// the internal call without a user session. keepalive: true so a
// serverless runtime doesn't tear the socket mid-flight. Any
// thrown error becomes a stderr line — the intake stays in
// 'processing' if the fetch never lands (future reaper cron).

export async function kickOffIntake(intakeId: string): Promise<void> {
  if (!intakeId) return;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "http://localhost:3000";
  const url = `${siteUrl}/api/intake/${encodeURIComponent(intakeId)}`;
  const token = mintInternalToken(intakeId);

  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Internal ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    keepalive: true,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[intake] kickoff failed for ${intakeId}: ${msg}\n`);
  });
}
