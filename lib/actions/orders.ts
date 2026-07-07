"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseLocalDateTime } from "@/lib/tz";
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

// Task 6A: sentinel error shape returned to the client so the dialog
// can render the "This looks like [existing customer] — use them
// instead?" banner. `collidingCustomerId` is parsed out of the
// SECURITY DEFINER RPC's DETAIL string.
export type CustomerCollisionError = {
  ok: false;
  error: string;
  code: "CUSTOMER_COLLIDES";
  collidingCustomerId: string;
};

function parseCollisionDetail(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = source.match(/colliding_customer_id=([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export async function createOrder(
  input: CreateOrderInputT,
): Promise<
  | ActionResult<{ id: string; orderNumber: string }>
  | CustomerCollisionError
> {
  const parsed = CreateOrderInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  const { userId, org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();
  const orgTz = org.timezone;

  // 1. Resolve customer + create order. Two paths:
  //   - existing customer id: two INSERTs (customer already exists,
  //     just insert the order via the classic path below).
  //   - inline new customer: SECURITY DEFINER RPC that runs the
  //     customer INSERT + order INSERT in one Postgres txn +
  //     collides against (lower(name), digits_only(phone)) with a
  //     distinctive CST01 sentinel error.
  let orderId: string;
  let orderNumber: string;

  if (v.customer.newCustomer) {
    const nc = v.customer.newCustomer;
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "create_customer_and_order",
      {
        p_customer: {
          name: nc.name,
          phone: nc.phone,
          company: nc.company ?? null,
          email: nc.email ?? null,
          city: nc.city ?? null,
          state: nc.state ?? null,
        },
        p_order: {
          contractor_id: toStringOrNull(v.contractorId),
          project_name: v.projectName,
          stone_type: toStringOrNull(v.stoneType),
          edge_profile: toStringOrNull(v.edgeProfile),
          sink_cutouts: v.sinkCutouts,
          cooktop_cutouts: v.cooktopCutouts,
          estimated_sqft: toNumericOrNull(v.estimatedSqft),
          quote_amount: toNumericOrNull(v.quoteAmount),
          deposit_received: v.depositReceived ?? 0,
          fabrication_start_date: toStringOrNull(v.fabricationStartDate),
          priority: v.priority,
          assigned_to: toStringOrNull(v.assignedTo),
          notes: toStringOrNull(v.notes),
        },
      },
    );
    if (rpcErr) {
      // Two shapes come back through PostgREST — some drivers keep
      // DETAIL, some don't. Check the code AND scan the text.
      const errAny = rpcErr as unknown as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
      const isCollision =
        errAny.code === "CST01" ||
        errAny.message?.toLowerCase().includes("customer collision");
      if (isCollision) {
        const collidingId =
          parseCollisionDetail(errAny.details) ??
          parseCollisionDetail(errAny.message);
        if (collidingId) {
          return {
            ok: false,
            error:
              "This looks like an existing customer. Use them instead of creating a duplicate.",
            code: "CUSTOMER_COLLIDES",
            collidingCustomerId: collidingId,
          };
        }
      }
      return { ok: false, error: rpcErr.message };
    }
    const rpc = rpcData as
      | { order_id: string; order_number: string; customer_id: string }
      | null;
    if (!rpc) {
      return { ok: false, error: "Could not create order" };
    }
    orderId = rpc.order_id;
    orderNumber = rpc.order_number;
  } else if (v.customer.existingCustomerId) {
    const customerId = v.customer.existingCustomerId;

    // Generate an order number via the RLS-safe SQL function.
    const { data: rpcValue, error: rpcError } = await supabase.rpc(
      "generate_order_number",
      { p_org_id: org.id },
    );
    if (rpcError || typeof rpcValue !== "string") {
      return {
        ok: false,
        error: rpcError?.message ?? "Could not assign order number",
      };
    }
    orderNumber = rpcValue;

    // Insert the order. measured_at and scheduled_install_date are NO
    // LONGER written here — order_events is the source of truth for
    // those (Task 3.1 PLAN Q5/Q13). Triggers write activity_log +
    // stage history.
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        org_id: org.id,
        order_number: orderNumber,
        customer_id: customerId,
        contractor_id: toStringOrNull(v.contractorId),
        project_name: v.projectName,
        stone_type: toStringOrNull(v.stoneType),
        edge_profile: toStringOrNull(v.edgeProfile),
        sink_cutouts: v.sinkCutouts,
        cooktop_cutouts: v.cooktopCutouts,
        estimated_sqft: toNumericOrNull(v.estimatedSqft),
        quote_amount: toNumericOrNull(v.quoteAmount),
        deposit_received: v.depositReceived ?? 0,
        fabrication_start_date: toStringOrNull(v.fabricationStartDate),
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
    orderId = orderRow.id;
  } else {
    return { ok: false, error: "Customer is required" };
  }

  // 2. Schedule events for measurement/install dates if provided.
  //    These run outside the RPC txn deliberately — an event failure
  //    should NOT roll back a successfully created order (matches
  //    Task 4 behavior; sub-step 1 DEVLOG covers the asymmetry).
  if (v.measuredAt) {
    const startsAt = parseLocalDateTime(v.measuredAt, "09:00", orgTz);
    const { error: evErr } = await supabase.rpc("create_order_event", {
      p_order_id: orderId,
      p_kind: "measurement",
      p_starts_at: startsAt.toISOString(),
      p_duration_min: 60,
      p_location_text: null,
      p_notes: null,
      p_assignments: [],
    });
    if (evErr) {
      return {
        ok: false,
        error: `Order created but measurement event failed: ${evErr.message}`,
      };
    }
  }
  if (v.scheduledInstallDate) {
    const startsAt = parseLocalDateTime(v.scheduledInstallDate, "10:00", orgTz);
    const { error: evErr } = await supabase.rpc("create_order_event", {
      p_order_id: orderId,
      p_kind: "install",
      p_starts_at: startsAt.toISOString(),
      p_duration_min: 180,
      p_location_text: null,
      p_notes: null,
      p_assignments: [],
    });
    if (evErr) {
      return {
        ok: false,
        error: `Order created but install event failed: ${evErr.message}`,
      };
    }
  }

  invalidate();
  return { ok: true, data: { id: orderId, orderNumber } };
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

  // measuredAt / scheduledInstallDate are no longer writable here — the
  // events table is the source of truth (PLAN Q5/Q13). The Order detail
  // sheet's date fields are read-only in this task; sub-step 8 surfaces
  // editing via the Events tab.
  if (patch.measuredAt !== undefined || patch.scheduledInstallDate !== undefined) {
    return {
      ok: false,
      error: "Measurement and install dates are managed via the Events tab.",
    };
  }

  const dbPatch: Record<string, unknown> = {};
  if (patch.projectName !== undefined) dbPatch.project_name = patch.projectName;
  if (patch.customerId !== undefined) dbPatch.customer_id = patch.customerId;
  // Empty string → clear (SET NULL on contractor_id). A real uuid sets it.
  if (patch.contractorId !== undefined) {
    dbPatch.contractor_id = patch.contractorId === "" ? null : patch.contractorId;
  }
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
  if (patch.fabricationStartDate !== undefined)
    dbPatch.fabrication_start_date = patch.fabricationStartDate;
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
