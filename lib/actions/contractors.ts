"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateContractorInput,
  DeleteContractorInput,
  UpdateContractorInput,
  type ContractorFieldsT,
} from "@/lib/validators/contractors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function toStringOrNull(value: string | undefined | null): string | null {
  return value === undefined || value === "" || value === null ? null : value;
}

function invalidate() {
  revalidatePath("/contractors");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
}

export async function createContractor(
  input: ContractorFieldsT,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateContractorInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const v = parsed.data;

  const { data, error } = await supabase
    .from("contractors")
    .insert({
      org_id: org.id,
      name: v.name,
      primary_contact: toStringOrNull(v.primaryContact),
      phone: toStringOrNull(v.phone),
      email: toStringOrNull(v.email),
      address_line1: toStringOrNull(v.addressLine1),
      address_line2: toStringOrNull(v.addressLine2),
      city: toStringOrNull(v.city),
      state: toStringOrNull(v.state),
      postal_code: toStringOrNull(v.postalCode),
      payment_terms: toStringOrNull(v.paymentTerms),
      notes: toStringOrNull(v.notes),
      is_active: v.isActive,
      created_by: userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create contractor" };
  }
  invalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateContractor(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateContractorInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, patch } = parsed.data;
  const supabase = createSupabaseServerClient();

  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.primaryContact !== undefined) dbPatch.primary_contact = patch.primaryContact ?? null;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone ?? null;
  if (patch.email !== undefined) dbPatch.email = patch.email ?? null;
  if (patch.addressLine1 !== undefined) dbPatch.address_line1 = patch.addressLine1 ?? null;
  if (patch.addressLine2 !== undefined) dbPatch.address_line2 = patch.addressLine2 ?? null;
  if (patch.city !== undefined) dbPatch.city = patch.city ?? null;
  if (patch.state !== undefined) dbPatch.state = patch.state ?? null;
  if (patch.postalCode !== undefined) dbPatch.postal_code = patch.postalCode ?? null;
  if (patch.paymentTerms !== undefined) dbPatch.payment_terms = patch.paymentTerms ?? null;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes ?? null;
  if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;

  const { error } = await supabase.from("contractors").update(dbPatch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id } };
}

export async function deleteContractor(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DeleteContractorInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();

  // Defense in depth on top of the UI gate: refuse if any orders still
  // reference this contractor, and if any payments remain. The FKs would
  // SET NULL the orders (catastrophic) and cascade-delete the payments,
  // so we block at the app layer first.
  const { count: orderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("contractor_id", parsed.data.id);
  if ((orderCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Contractor still has orders attached — reassign or deactivate instead.",
    };
  }

  const { count: paymentCount } = await supabase
    .from("contractor_payments")
    .select("id", { count: "exact", head: true })
    .eq("contractor_id", parsed.data.id);
  if ((paymentCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Contractor has payment history — deactivate instead of deleting.",
    };
  }

  const { error } = await supabase
    .from("contractors")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id: parsed.data.id } };
}
