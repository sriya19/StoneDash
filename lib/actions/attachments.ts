"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  insertExtractionRow,
  kickOffExtraction,
} from "@/lib/actions/extractions";

type OrgAiSetting = { ai_auto_extract: boolean };

const RegisterInput = z.object({
  orderId: z.string().uuid(),
  storagePath: z.string().min(1),
  originalName: z.string().min(1).max(512),
  mime: z.string().max(200).optional(),
  sizeBytes: z.number().int().min(0).max(25 * 1024 * 1024),
  kind: z.enum(["template", "contract", "photo", "invoice", "other"]).default("other"),
});

export async function registerAttachment(input: unknown): Promise<
  { ok: true; data: { id: string } } | { ok: false; error: string }
> {
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("order_attachments")
    .insert({
      org_id: org.id,
      order_id: parsed.data.orderId,
      storage_path: parsed.data.storagePath,
      original_name: parsed.data.originalName,
      mime: parsed.data.mime ?? null,
      size_bytes: parsed.data.sizeBytes,
      kind: parsed.data.kind,
      uploaded_by: userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not register attachment" };
  }

  // Task 5: kick off an AI extraction unless the org has opted out.
  // Wrapped in try/catch so an extraction failure never fails the
  // upload — the storage bytes + order_attachments row stay
  // authoritative. Q7 lock: the file_extractions row is INSERTed
  // synchronously so the chip renders at the same beat as the file
  // card.
  try {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("ai_auto_extract")
      .eq("id", org.id)
      .maybeSingle<OrgAiSetting>();

    if (orgRow?.ai_auto_extract !== false) {
      const insertRes = await insertExtractionRow(supabase, {
        orgId: org.id,
        fileId: data.id,
      });
      if (insertRes.ok) {
        await kickOffExtraction(data.id);
      } else {
        process.stderr.write(
          `[attachments] extraction insert failed for ${data.id}: ${insertRes.error}\n`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[attachments] extraction kickoff threw for ${data.id}: ${msg}\n`,
    );
  }

  revalidatePath("/orders");
  return { ok: true, data: { id: data.id } };
}

const DeleteInput = z.object({ id: z.string().uuid(), storagePath: z.string().min(1) });

export async function deleteAttachment(input: unknown): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();

  // Storage delete first (bucket is private, RLS-gated by org_id).
  const { error: storageError } = await supabase.storage
    .from("order-files")
    .remove([parsed.data.storagePath]);
  if (storageError) {
    return { ok: false, error: storageError.message };
  }

  const { error } = await supabase
    .from("order_attachments")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/orders");
  return { ok: true };
}

export async function createSignedUrl(
  storagePath: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("order-files")
    .createSignedUrl(storagePath, 60 * 10);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not sign URL" };
  }
  return { ok: true, url: data.signedUrl };
}

// Batch signer — one round-trip per N paths. Used by the photo gallery
// so every thumbnail doesn't do its own network hop. Returns a map from
// storage path to signed URL (or null for paths that failed to sign).
export async function createSignedUrls(
  storagePaths: string[],
  ttlSeconds = 60 * 60,
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("order-files")
    .createSignedUrls(storagePaths, ttlSeconds);
  if (error || !data) return {};
  const result: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) result[row.path] = row.signedUrl;
  }
  return result;
}
