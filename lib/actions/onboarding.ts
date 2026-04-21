"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingInput, type OnboardingInputT } from "@/lib/validators/onboarding";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string[]> };

export async function completeOnboarding(
  input: OnboardingInputT,
): Promise<ActionResult<{ orgId: string }>> {
  const parsed = OnboardingInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please correct the highlighted fields.",
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not signed in" };
  }

  // 1. Upsert the profile with the user's name. active_org_id is set later
  // once the org is created.
  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      full_name: parsed.data.fullName,
      theme: "light",
    },
    { onConflict: "id" },
  );
  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  // 2. Create the organization. owner_id must equal auth.uid() per RLS.
  // An empty order_prefix is filled by the BEFORE INSERT trigger in 0001.
  const { data: orgRow, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: parsed.data.shopName,
      slug: parsed.data.slug,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      order_prefix: parsed.data.orderPrefix ?? "",
      order_seq_start: parsed.data.orderSeqStart ?? 1000,
      owner_id: user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (orgError || !orgRow) {
    return {
      ok: false,
      error: orgError?.message ?? "Could not create organization",
    };
  }

  // 3. Owner membership. Policy allows this bootstrap insert because
  // organizations.owner_id = auth.uid() and role = 'owner' + accepted.
  const { error: memberError } = await supabase.from("org_members").insert({
    org_id: orgRow.id,
    user_id: user.id,
    role: "owner",
    invite_accepted_at: new Date().toISOString(),
  });
  if (memberError) {
    return { ok: false, error: memberError.message };
  }

  // 4. Set active_org_id so subsequent requests resolve to this org.
  const { error: activeError } = await supabase
    .from("profiles")
    .update({ active_org_id: orgRow.id })
    .eq("id", user.id);
  if (activeError) {
    return { ok: false, error: activeError.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { orgId: orgRow.id } };
}
