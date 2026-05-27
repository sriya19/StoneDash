"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateCrewMemberInput,
  DeleteCrewMemberInput,
  UpdateCrewMemberInput,
  type CrewMemberFieldsT,
} from "@/lib/validators/crew";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function toStringOrNull(value: string | undefined | null): string | null {
  return value === undefined || value === "" || value === null ? null : value;
}

function invalidate() {
  revalidatePath("/team");
  revalidatePath("/schedule");
}

export async function createCrewMember(
  input: CrewMemberFieldsT,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateCrewMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const v = parsed.data;

  const { data, error } = await supabase
    .from("crew_members")
    .insert({
      org_id: org.id,
      name: v.name,
      role: toStringOrNull(v.role),
      phone: toStringOrNull(v.phone),
      email: toStringOrNull(v.email),
      notes: toStringOrNull(v.notes),
      is_active: v.isActive,
      created_by: userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create crew member" };
  }
  invalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateCrewMember(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateCrewMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, patch } = parsed.data;
  const supabase = createSupabaseServerClient();

  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.role !== undefined) dbPatch.role = patch.role ?? null;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone ?? null;
  if (patch.email !== undefined) dbPatch.email = patch.email ?? null;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes ?? null;
  if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;

  const { error } = await supabase.from("crew_members").update(dbPatch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id } };
}

export async function deleteCrewMember(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DeleteCrewMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();

  // Defense in depth on top of the UI gate: refuse if the crew member has
  // ANY historical assignments (past or future). The FK to
  // order_event_assignments is ON DELETE CASCADE, which would silently
  // wipe their history of every job they were on — bad for audit trails.
  // Operator should deactivate instead.
  const { count } = await supabase
    .from("order_event_assignments")
    .select("id", { count: "exact", head: true })
    .eq("crew_member_id", parsed.data.id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "Crew member has assignment history — deactivate instead of deleting.",
    };
  }

  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id: parsed.data.id } };
}
