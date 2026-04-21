"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Switches the caller's active org. The target org must be one the caller is
// a member of; RLS prevents writing active_org_id to anything else.
export async function switchActiveOrg(orgId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: membership, error: memErr } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .not("invite_accepted_at", "is", null)
    .maybeSingle<{ org_id: string }>();

  if (memErr) return { ok: false, error: memErr.message };
  if (!membership) return { ok: false, error: "You are not a member of that shop" };

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ active_org_id: orgId })
    .eq("id", user.id);

  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
