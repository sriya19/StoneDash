"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mintInternalToken } from "@/lib/extraction/internal-token";
import { hasAtLeast } from "@/lib/rbac";
import type { FileExtractionRow } from "@/lib/supabase/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// kickOffExtraction — fire-and-forget internal call
// ---------------------------------------------------------------------------
//
// Called by registerAttachment (attachments.ts) after the
// file_extractions row is inserted with status='processing'. Fires
// off a POST to /api/extract/[fileId] with the HMAC-signed token
// and does NOT await the response. The internal route handler
// updates the same row when the pipeline finishes.
//
// If the fetch itself fails (network / cold start), we log and move
// on — the row stays in `processing` and the reaper (future task)
// will eventually re-kick it. The upload succeeds either way.

export async function kickOffExtraction(fileId: string): Promise<void> {
  if (!fileId || typeof fileId !== "string") return;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "http://localhost:3000";
  const url = `${siteUrl}/api/extract/${encodeURIComponent(fileId)}`;
  const token = mintInternalToken(fileId);

  // Fire-and-forget. keepalive: true so a serverless runtime doesn't
  // tear down the socket while the request is in flight. Explicitly
  // do NOT await — the caller returns immediately.
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
    process.stderr.write(`[extractions] kickoff failed for ${fileId}: ${msg}\n`);
  });
}

// ---------------------------------------------------------------------------
// insertExtractionRow — synchronous companion insert
// ---------------------------------------------------------------------------
//
// PLAN Q7 lock: the file_extractions row is INSERTed synchronously
// alongside the order_attachments row so the chip renders at the
// same beat as the file card (no half-second gap where the chip is
// missing).
//
// Called only from within registerAttachment; kept here so it can
// reuse the same supabase client but is exported for tests + the
// mocked kickoff path.

export async function insertExtractionRow(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  args: { orgId: string; fileId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("file_extractions").insert({
    org_id: args.orgId,
    file_id: args.fileId,
    document_type: "other",
    status: "processing",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// confirmExtraction — approve + apply downstream actions
// ---------------------------------------------------------------------------
//
// Sub-step 4 lands the state transition. Sub-step 7 wires in the
// downstream action applier (update_order_field / create_reminder);
// today confirmExtraction just sets status='confirmed' and stores
// the possibly-edited fields. That's a deliberate two-step delivery
// — sub-step 4 is invisible to the user, and sub-step 7 adds the
// visible payoff.

const ConfirmInput = z.object({
  id: z.string().uuid(),
  editedFields: z.record(z.string(), z.unknown()).optional(),
});

export async function confirmExtraction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can confirm extractions" };
  }

  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  const update: Record<string, unknown> = {
    status: "confirmed",
    reviewed_at: nowIso,
    updated_at: nowIso,
  };
  if (parsed.data.editedFields) {
    update.extracted_fields = parsed.data.editedFields;
  }

  const { data, error } = await supabase
    .from("file_extractions")
    .update(update)
    .eq("id", parsed.data.id)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not confirm extraction" };
  }

  // Best-effort: set reviewed_by via a follow-up UPDATE so RLS can't
  // complain about missing session context. RLS-scoped updates run
  // as the authenticated user, so auth.uid() is available on the
  // trigger — but reviewed_by is a data column we still fill.
  const { userId } = await getCurrentUserAndOrg();
  await supabase
    .from("file_extractions")
    .update({ reviewed_by: userId })
    .eq("id", parsed.data.id);

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// declineExtraction — mark as user-declined, no downstream state
// ---------------------------------------------------------------------------

const DeclineInput = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function declineExtraction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DeclineInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { userId, role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can decline extractions" };
  }

  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("file_extractions")
    .update({
      status: "declined",
      reviewed_by: userId,
      reviewed_at: nowIso,
      error_message: parsed.data.reason?.trim() || null,
      updated_at: nowIso,
    })
    .eq("id", parsed.data.id)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not decline extraction" };
  }

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: data.id } };
}

// ---------------------------------------------------------------------------
// reExtractFile — DELETE + INSERT + kickoff again
// ---------------------------------------------------------------------------
//
// The user says "the extraction was wrong, try again." We delete
// the existing row (audit trigger cleans up the polymorphic
// activity_log rows), insert a fresh processing row, and fire the
// pipeline again.

const ReExtractInput = z.object({ fileId: z.string().uuid() });

export async function reExtractFile(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ReExtractInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { org, role } = await getCurrentUserAndOrg();
  if (!hasAtLeast(role, "manager")) {
    return { ok: false, error: "Only managers and above can re-extract files" };
  }

  const supabase = createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("file_extractions")
    .select("id, org_id, file_id")
    .eq("file_id", parsed.data.fileId)
    .maybeSingle<Pick<FileExtractionRow, "id" | "org_id" | "file_id">>();

  if (existing) {
    const { error } = await supabase
      .from("file_extractions")
      .delete()
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  }

  const insertRes = await insertExtractionRow(supabase, {
    orgId: org.id,
    fileId: parsed.data.fileId,
  });
  if (!insertRes.ok) return { ok: false, error: insertRes.error };

  await kickOffExtraction(parsed.data.fileId);

  revalidatePath("/orders");
  return { ok: true, data: { id: parsed.data.fileId } };
}
