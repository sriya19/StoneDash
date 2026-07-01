"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const IdInput = z.object({ id: z.string().uuid() });

// Dismiss = "I saw this, don't show it in the bell again."
// The reminder stays in the DB (for audit + the /reminders Dismissed
// tab) but drops out of the active list.
export async function dismissReminder(input: unknown): Promise<ActionResult> {
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await getCurrentUserAndOrg(); // gate on session; RLS handles the ownership check
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("reminders")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reminders");
  return { ok: true, data: undefined };
}

// Complete = "I did the thing this reminder was about."
// Also sets dismissed_at so it drops out of the active list; the
// separate completed_at column is retained so a future report can
// distinguish "I resolved this" from "I don't care about this."
export async function completeReminder(input: unknown): Promise<ActionResult> {
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("reminders")
    .update({ dismissed_at: nowIso, completed_at: nowIso })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reminders");
  return { ok: true, data: undefined };
}
