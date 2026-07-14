"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

// ---------------------------------------------------------------------------
// confirmIntake / discardIntake
// ---------------------------------------------------------------------------
//
// confirm: calls apply_intake (SECURITY DEFINER, sub-step 10
// fills in the real body). Landing the wrapper now so sub-step
// 9's review sheet has a stable action to call.
//
// discard: fully implemented — a status transition, no downstream
// state. Manager+ gated here + at the DB via RLS from 0022.

export async function confirmIntake(input: {
  intakeId: string;
  edits: Record<string, unknown>;
  selectedActionKeys: string[];
}): Promise<ActionResult<{ applied: ApplyIntakeEntry[] }>> {
  const { userId, org, role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can confirm intakes" };
  }
  const supabase = createSupabaseServerClient();

  // 1. Atomic-in-Postgres: customer + order + event + note +
  //    activity_log in one txn (apply_intake RPC from 0024).
  const { data, error } = await supabase.rpc("apply_intake", {
    p_intake_id: input.intakeId,
    p_edits: input.edits,
    p_selected_action_keys: input.selectedActionKeys,
  });
  if (error) return { ok: false, error: error.message };
  const applied: ApplyIntakeEntry[] = Array.isArray(data)
    ? (data as ApplyIntakeEntry[])
    : [];

  // 2. Screenshot copy — PLAN Q12. Bucket-level server-side COPY
  //    from {org}/intake/... to {org}/{order_id}/... + insert an
  //    order_attachments row. Non-fatal — if the RPC succeeded
  //    but the copy fails, the intake is still 'confirmed'; we
  //    log and move on. The intake row keeps its own copy for
  //    audit.
  const createdOrder = applied.find(
    (a) => a.type === "create_order" && typeof a.entity_id === "string",
  );
  const matchedOrderId = pickMatchedOrderIdFromApplied(applied);
  const targetOrderId =
    (createdOrder?.entity_id as string | undefined) ?? matchedOrderId ?? null;

  if (targetOrderId) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: intakeRow } = await admin
        .from("ai_intake_events")
        .select("storage_path")
        .eq("id", input.intakeId)
        .maybeSingle<{ storage_path: string }>();
      if (intakeRow?.storage_path) {
        const filename =
          intakeRow.storage_path.split("/").pop() ?? "intake.png";
        const attachmentKey = crypto.randomUUID();
        const newPath = `${org.id}/${targetOrderId}/${attachmentKey}-${filename}`;
        const { error: copyErr } = await admin.storage
          .from("order-files")
          .copy(intakeRow.storage_path, newPath);
        if (!copyErr) {
          await admin.from("order_attachments").insert({
            org_id: org.id,
            order_id: targetOrderId,
            storage_path: newPath,
            original_name: filename,
            mime: null,
            size_bytes: null,
            kind: "photo",
            uploaded_by: userId,
          });
        } else {
          process.stderr.write(
            `[intake] screenshot copy failed: ${copyErr.message}\n`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[intake] copy path threw: ${msg}\n`);
    }
  }

  revalidatePath("/intake");
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  return { ok: true, data: { applied } };
}

type ApplyIntakeEntry = {
  type: string;
  key?: string;
  entity_id?: string;
  order_number?: string;
};

function pickMatchedOrderIdFromApplied(
  entries: ApplyIntakeEntry[],
): string | null {
  const noteOrEvent = entries.find(
    (a) =>
      (a.type === "append_note" || a.type === "create_event") &&
      typeof a.entity_id === "string",
  );
  return (noteOrEvent?.entity_id as string | undefined) ?? null;
}

export async function discardIntake(input: {
  intakeId: string;
  reason?: string;
}): Promise<ActionResult> {
  const { userId, role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can discard intakes" };
  }
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("ai_intake_events")
    .update({
      status: "discarded",
      reviewed_by: userId,
      reviewed_at: nowIso,
      error_message: input.reason?.trim() || null,
      updated_at: nowIso,
    })
    .eq("id", input.intakeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/intake");
  return { ok: true, data: undefined };
}
