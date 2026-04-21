"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateCustomerInput,
  DeleteCustomerInput,
  UpdateCustomerInput,
  type CustomerFieldsT,
} from "@/lib/validators/customers";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function toStringOrNull(value: string | undefined | null): string | null {
  return value === undefined || value === "" || value === null ? null : value;
}

function invalidate() {
  revalidatePath("/customers");
  revalidatePath("/orders");
  revalidatePath("/dashboard");
}

export async function createCustomer(
  input: CustomerFieldsT,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateCustomerInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const v = parsed.data;
  const { data, error } = await supabase
    .from("customers")
    .insert({
      org_id: org.id,
      name: v.name,
      company: toStringOrNull(v.company),
      email: toStringOrNull(v.email),
      phone: toStringOrNull(v.phone),
      address_line1: toStringOrNull(v.addressLine1),
      address_line2: toStringOrNull(v.addressLine2),
      city: toStringOrNull(v.city),
      state: toStringOrNull(v.state),
      postal_code: toStringOrNull(v.postalCode),
      notes: toStringOrNull(v.notes),
      created_by: userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create customer" };
  }
  invalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateCustomer(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateCustomerInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, patch } = parsed.data;
  const supabase = createSupabaseServerClient();

  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.company !== undefined) dbPatch.company = patch.company ?? null;
  if (patch.email !== undefined) dbPatch.email = patch.email ?? null;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone ?? null;
  if (patch.addressLine1 !== undefined) dbPatch.address_line1 = patch.addressLine1 ?? null;
  if (patch.addressLine2 !== undefined) dbPatch.address_line2 = patch.addressLine2 ?? null;
  if (patch.city !== undefined) dbPatch.city = patch.city ?? null;
  if (patch.state !== undefined) dbPatch.state = patch.state ?? null;
  if (patch.postalCode !== undefined) dbPatch.postal_code = patch.postalCode ?? null;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes ?? null;

  const { error } = await supabase.from("customers").update(dbPatch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id } };
}

export async function deleteCustomer(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DeleteCustomerInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("customers").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { id: parsed.data.id } };
}
