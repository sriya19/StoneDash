"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  AcceptInviteInput,
  InviteMemberInput,
  RemoveMemberInput,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
  UpdateProfileInput,
  type InviteMemberInputT,
  type UpdateOrganizationInputT,
  type UpdateProfileInputT,
} from "@/lib/validators/settings";

type OrgMemberPending = {
  id: string;
  org_id: string;
  user_id: string | null;
  role: string;
  invite_token: string | null;
  invite_accepted_at: string | null;
  invited_email: string | null;
};

type ActionOk<T = undefined> = { ok: true; data: T };
type ActionErr = { ok: false; error: string };
type ActionResult<T = undefined> = ActionOk<T> | ActionErr;

export async function updateProfile(
  input: UpdateProfileInputT,
): Promise<ActionResult> {
  const parsed = UpdateProfileInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { userId } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone ?? null,
      theme: parsed.data.theme,
    })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function updateOrganization(
  input: UpdateOrganizationInputT,
): Promise<ActionResult> {
  const parsed = UpdateOrganizationInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      order_prefix: parsed.data.orderPrefix,
      order_seq_start: parsed.data.orderSeqStart,
    })
    .eq("id", org.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function inviteMember(
  input: InviteMemberInputT,
): Promise<ActionResult<{ token: string; memberId: string }>> {
  const parsed = InviteMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const token = `inv_${randomUUID().replace(/-/g, "")}`;

  const { data, error } = await supabase
    .from("org_members")
    .insert({
      org_id: org.id,
      role: parsed.data.role,
      invited_email: parsed.data.email,
      invite_token: token,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create invite" };
  }
  revalidatePath("/settings");
  return { ok: true, data: { token, memberId: data.id } };
}

export async function updateMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = UpdateMemberRoleInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("org_members")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.memberId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function removeMember(input: unknown): Promise<ActionResult> {
  const parsed = RemoveMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("id", parsed.data.memberId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

// Accept an invite. The RLS policy allows the invited user to update their
// own row only if their auth.users email matches invited_email. Since the
// inviter may have typed a different email than what the invitee uses to
// sign up, we accept the invite server-side via the admin client (checking
// the token is still valid and not yet claimed).
export async function acceptInvite(
  input: unknown,
): Promise<ActionResult<{ orgId: string }>> {
  const parsed = AcceptInviteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first" };

  const admin = createSupabaseAdminClient();
  const { data: member, error: fetchError } = await admin
    .from("org_members")
    .select("id, org_id, user_id, role, invite_token, invite_accepted_at, invited_email")
    .eq("invite_token", parsed.data.token)
    .maybeSingle<OrgMemberPending>();

  if (fetchError) return { ok: false, error: fetchError.message };
  if (!member) return { ok: false, error: "Invite not found" };
  if (member.invite_accepted_at) {
    return { ok: false, error: "This invite has already been used" };
  }

  const { error: updateError } = await admin
    .from("org_members")
    .update({
      user_id: user.id,
      invite_accepted_at: new Date().toISOString(),
      invite_token: null,
    })
    .eq("id", member.id);

  if (updateError) return { ok: false, error: updateError.message };

  // Set active org if the user doesn't have one.
  const { data: profile } = await admin
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .maybeSingle<{ active_org_id: string | null }>();

  if (!profile?.active_org_id) {
    await admin
      .from("profiles")
      .upsert({ id: user.id, active_org_id: member.org_id });
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { orgId: member.org_id } };
}
