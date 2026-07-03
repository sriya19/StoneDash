"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canEditOrganization } from "@/lib/rbac";

const UpdateInput = z.object({
  ai_auto_extract: z.boolean().optional(),
  ai_email_on_review: z.boolean().optional(),
});

export async function updateAiSettings(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { org, role } = await getCurrentUserAndOrg();
  if (!canEditOrganization(role)) {
    return { ok: false, error: "Only owners and admins can change AI settings" };
  }
  const patch: Record<string, boolean> = {};
  if (parsed.data.ai_auto_extract !== undefined)
    patch.ai_auto_extract = parsed.data.ai_auto_extract;
  if (parsed.data.ai_email_on_review !== undefined)
    patch.ai_email_on_review = parsed.data.ai_email_on_review;
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update(patch)
    .eq("id", org.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}
