"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BulkChangeStageInput,
  ChangeStageInput,
  CreateOrderInput,
  DeleteOrderInput,
  UpdateOrderInput,
  type CreateOrderInputT,
  type UpdateOrderInputT,
} from "@/lib/validators/orders";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function toNumericOrNull(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value) ? null : value;
}

function toStringOrNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function invalidate() {
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath("/customers");
}

export async function createOrder(
  input: CreateOrderInputT,
): Promise<ActionResult<{ id: string; orderNumber: string }>> {
  const parsed = CreateOrderInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  // 1. Resolve customer — either the existing id or create a new row.
  let customerId: string;
  if (v.customer.existingCustomerId) {
    customerId = v.customer.existingCustomerId;
  } else if (v.customer.newCustomer) {
    const nc = v.customer.newCustomer;
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        org_id: org.id,
        name: nc.name,
        company: toStringOrNull(nc.company),
        email: toStringOrNull(nc.email),
        phone: nc.phone,
        city: toStringOrNull(nc.city),
        state: toStringOrNull(nc.state),
        created_by: userId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !created) {
      return { ok: false, error: error?.message ?? "Could not create customer" };
    }
    customerId = created.id;
  } else {
    return { ok: false, error: "Customer is required" };
  }

  // 2. Generate an order number via the RLS-safe SQL function.
  const { data: rpcValue, error: rpcError } = await supabase.rpc(
    "generate_order_number",
    { p_org_id: org.id },
  );
  if (rpcError || typeof rpcValue !== "string") {
    return { ok: false, error: rpcError?.message ?? "Could not assign order number" };
  }
  const orderNumber = rpcValue;

  // 3. Insert the order. Triggers write activity_log + stage history.
  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .insert({
      org_id: org.id,
      order_number: orderNumber,
      customer_id: customerId,
      project_name: v.projectName,
      stone_type: toStringOrNull(v.stoneType),
      edge_profile: toStringOrNull(v.edgeProfile),
      sink_cutouts: v.sinkCutouts,
      cooktop_cutouts: v.cooktopCutouts,
      estimated_sqft: toNumericOrNull(v.estimatedSqft),
      quote_amount: toNumericOrNull(v.quoteAmount),
      deposit_received: v.depositReceived ?? 0,
      measured_at: toStringOrNull(v.measuredAt),
      fabrication_start_date: toStringOrNull(v.fabricationStartDate),
      scheduled_install_date: toStringOrNull(v.scheduledInstallDate),
      priority: v.priority,
      assigned_to: toStringOrNull(v.assignedTo),
      notes: toStringOrNull(v.notes),
      created_by: userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (orderErr || !orderRow) {
    return { ok: false, error: orderErr?.message ?? "Could not create order" };
  }

  invalidate();
  return { ok: true, data: { id: orderRow.id, orderNumber } };
}

export async function updateOrder(
  input: UpdateOrderInputT,
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateOrderInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input" };
  }
  const { id, patch } = parsed.data;

  const supabase = createSupabaseServerClient();

  const dbPatch: Record<string, unknown> = {};
  if (patch.projectName !== undefined) dbPatch.project_name = patch.projectName;
  if (patch.customerId !== undefined) dbPatch.customer_id = patch.customerId;
  // Stage changes are intentionally not handled here — callers must go
  // through changeStage() so a reason is recorded.
  if (patch.priority !== undefined) dbPatch.priority = patch.priority;
  if (patch.stoneType !== undefined) dbPatch.stone_type = patch.stoneType;
  if (patch.edgeProfile !== undefined) dbPatch.edge_profile = patch.edgeProfile;
  if (patch.sinkCutouts !== undefined) dbPatch.sink_cutouts = patch.sinkCutouts;
  if (patch.cooktopCutouts !== undefined) dbPatch.cooktop_cutouts = patch.cooktopCutouts;
  if (patch.estimatedSqft !== undefined) dbPatch.estimated_sqft = patch.estimatedSqft;
  if (patch.quoteAmount !== undefined) dbPatch.quote_amount = patch.quoteAmount;
  if (patch.depositReceived !== undefined) dbPatch.deposit_received = patch.depositReceived;
  if (patch.measuredAt !== undefined) dbPatch.measured_at = patch.measuredAt;
  if (patch.fabricationStartDate !== undefined)
    dbPatch.fabrication_start_date = patch.fabricationStartDate;
  if (patch.scheduledInstallDate !== undefined)
    dbPatch.scheduled_install_date = patch.scheduledInstallDate;
  if (patch.installedAt !== undefined) dbPatch.installed_at = patch.installedAt;
  if (patch.assignedTo !== undefined) dbPatch.assigned_to = patch.assignedTo;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;

  const { error } = await supabase.from("orders").update(dbPatch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  invalidate();
  return { ok: true, data: { id } };
}

export async function changeStage(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ChangeStageInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createSupabaseServerClient();
  // change_order_stage sets a transaction-local GUC for the note and then
  // performs the UPDATE. The audit trigger (tg_orders_after_update) reads
  // the GUC and writes the reason into order_stage_history.note and
  // activity_log.metadata.note in the same transaction.
  const { error } = await supabase.rpc("change_order_stage", {
    p_order_id: parsed.data.id,
    p_to_stage: parsed.data.toStage,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: error.message };

  invalidate();
  return { ok: true, data: { id: parsed.data.id } };
}

export async function bulkChangeStage(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  const parsed = BulkChangeStageInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ stage: parsed.data.toStage })
    .in("id", parsed.data.ids);
  if (error) return { ok: false, error: error.message };

  invalidate();
  return { ok: true, data: { count: parsed.data.ids.length } };
}

export async function deleteOrder(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DeleteOrderInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("orders").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  invalidate();
  return { ok: true, data: { id: parsed.data.id } };
}
