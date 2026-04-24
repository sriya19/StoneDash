"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateContractorInput,
  DeleteContractorInput,
  DeletePaymentInput,
  RecordPaymentInput,
  UpdateContractorInput,
  UpdatePaymentInput,
  type ContractorFieldsT,
  type RecordPaymentInputT,
  type UpdatePaymentInputT,
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

function invalidateForContractor(contractorId: string) {
  revalidatePath("/contractors");
  revalidatePath(`/contractors/${contractorId}`);
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

// ---------- payments (RPC-only write path) ----------
//
// All three call into the SECURITY DEFINER functions from 0012. The RPCs
// re-check auth + role and validate the sum invariant. We translate JS
// camelCase into snake_case RPC params here.

export async function recordContractorPayment(
  input: RecordPaymentInputT,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = RecordPaymentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase.rpc("record_contractor_payment", {
    p_contractor_id: v.contractorId,
    p_amount: v.amount,
    p_received_on: v.receivedOn,
    p_method: v.method ?? null,
    p_reference: v.reference ?? null,
    p_notes: v.notes ?? null,
    p_allocations: v.allocations.map((a) => ({
      order_id: a.orderId,
      amount: a.amount,
    })),
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: error?.message ?? "Could not record payment" };
  }
  invalidateForContractor(v.contractorId);
  return { ok: true, data: { paymentId: data } };
}

export async function updateContractorPayment(
  input: UpdatePaymentInputT,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = UpdatePaymentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.rpc("update_contractor_payment", {
    p_payment_id: v.paymentId,
    p_amount: v.amount,
    p_received_on: v.receivedOn,
    p_method: v.method ?? null,
    p_reference: v.reference ?? null,
    p_notes: v.notes ?? null,
    p_allocations: v.allocations.map((a) => ({
      order_id: a.orderId,
      amount: a.amount,
    })),
  });
  if (error) return { ok: false, error: error.message };
  invalidateForContractor(v.contractorId);
  return { ok: true, data: { paymentId: v.paymentId } };
}

export async function deleteContractorPayment(
  input: unknown,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = DeletePaymentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.rpc("delete_contractor_payment", {
    p_payment_id: parsed.data.paymentId,
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { paymentId: parsed.data.paymentId } };
}
