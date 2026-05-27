"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseLocalDateTime, sameUtcDay } from "@/lib/tz";
import {
  CreateEventInput,
  DeleteEventInput,
  RescheduleEventInput,
  UpdateEventInput,
  UpdateEventStatusInput,
  type CreateEventInputT,
  type UpdateEventInputT,
} from "@/lib/validators/events";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function invalidate() {
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath("/team");
}

function computeStartsAt(date: string, time: string, durationMin: number, tz: string): string {
  const starts = parseLocalDateTime(date, time, tz);
  const ends = new Date(starts.getTime() + durationMin * 60_000);
  if (!sameUtcDay(starts, ends)) {
    throw new Error(
      "Event must start and end on the same UTC day (no overnight events in v1).",
    );
  }
  return starts.toISOString();
}

export async function createOrderEvent(
  input: CreateEventInputT,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = CreateEventInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  let startsAtIso: string;
  try {
    startsAtIso = computeStartsAt(v.date, v.startTime, v.durationMin, org.timezone);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const { data, error } = await supabase.rpc("create_order_event", {
    p_order_id: v.orderId,
    p_kind: v.kind,
    p_starts_at: startsAtIso,
    p_duration_min: v.durationMin,
    p_location_text: v.locationText ?? null,
    p_notes: v.notes ?? null,
    p_assignments: v.assignments.map((a) => ({
      crew_member_id: a.crewMemberId,
      role: a.role ?? null,
    })),
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: error?.message ?? "Could not create event" };
  }
  invalidate();
  return { ok: true, data: { eventId: data } };
}

export async function updateOrderEvent(
  input: UpdateEventInputT,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = UpdateEventInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  let startsAtIso: string;
  try {
    startsAtIso = computeStartsAt(v.date, v.startTime, v.durationMin, org.timezone);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const { error } = await supabase.rpc("update_order_event", {
    p_event_id: v.eventId,
    p_kind: v.kind,
    p_starts_at: startsAtIso,
    p_duration_min: v.durationMin,
    p_location_text: v.locationText ?? null,
    p_notes: v.notes ?? null,
    p_assignments: v.assignments.map((a) => ({
      crew_member_id: a.crewMemberId,
      role: a.role ?? null,
    })),
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { eventId: v.eventId } };
}

export async function deleteOrderEvent(
  input: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = DeleteEventInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_order_event", {
    p_event_id: parsed.data.eventId,
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { eventId: parsed.data.eventId } };
}

export async function rescheduleOrderEvent(
  input: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = RescheduleEventInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  // Fetch current event so we can preserve all fields except starts_at +
  // duration_min. update_order_event REPLACES every field; passing nulls
  // for location/notes/assignments would wipe them.
  const { data: existing, error: fetchErr } = await supabase
    .from("order_events")
    .select("kind, location_text, notes")
    .eq("id", v.eventId)
    .maybeSingle<{
      kind: string;
      location_text: string | null;
      notes: string | null;
    }>();
  if (fetchErr || !existing) {
    return { ok: false, error: fetchErr?.message ?? "Event not found" };
  }

  const { data: assignments, error: aErr } = await supabase
    .from("order_event_assignments")
    .select("crew_member_id, role")
    .eq("event_id", v.eventId)
    .returns<{ crew_member_id: string; role: string | null }[]>();
  if (aErr) return { ok: false, error: aErr.message };

  let startsAtIso: string;
  try {
    startsAtIso = computeStartsAt(v.date, v.startTime, v.durationMin, org.timezone);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const { error } = await supabase.rpc("update_order_event", {
    p_event_id: v.eventId,
    p_kind: existing.kind,
    p_starts_at: startsAtIso,
    p_duration_min: v.durationMin,
    p_location_text: existing.location_text,
    p_notes: existing.notes,
    p_assignments: (assignments ?? []).map((a) => ({
      crew_member_id: a.crew_member_id,
      role: a.role,
    })),
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { eventId: v.eventId } };
}

export async function updateOrderEventStatus(
  input: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = UpdateEventStatusInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("update_event_status", {
    p_event_id: parsed.data.eventId,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { eventId: parsed.data.eventId } };
}

// ---------- conflict warning ----------
//
// Called from the dialog (debounced) to surface "Carlos has another install
// at 10 AM-1 PM" inline. Soft warning, not a blocker.

export type CrewConflict = {
  eventId: string;
  crewMemberId: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  orderNumber: string;
  projectName: string | null;
};

type ConflictDb = {
  event_id: string;
  crew_member_id: string;
  order_events: {
    starts_at: string;
    ends_at: string;
    kind: string;
    status: string;
    orders: { order_number: string; project_name: string | null } | null;
  } | null;
};

export async function getCrewConflicts(input: {
  crewIds: string[];
  startsAtIso: string;
  endsAtIso: string;
  excludeEventId?: string;
}): Promise<CrewConflict[]> {
  if (input.crewIds.length === 0) return [];
  const supabase = createSupabaseServerClient();
  // Two events overlap iff starts_at < other.ends_at AND ends_at > other.starts_at.
  // Live conflicts only — past/complete/cancelled events don't count.
  let query = supabase
    .from("order_event_assignments")
    .select(
      "event_id, crew_member_id, order_events!inner(starts_at, ends_at, kind, status, orders!inner(order_number, project_name))",
    )
    .in("crew_member_id", input.crewIds)
    .lt("order_events.starts_at", input.endsAtIso)
    .gt("order_events.ends_at", input.startsAtIso)
    .not("order_events.status", "in", "(cancelled,no_show,complete)");
  if (input.excludeEventId) query = query.neq("event_id", input.excludeEventId);

  const { data, error } = await query.returns<ConflictDb[]>();
  if (error) throw error;

  return (data ?? [])
    .filter((row): row is ConflictDb & { order_events: NonNullable<ConflictDb["order_events"]> } =>
      row.order_events !== null,
    )
    .map((row) => ({
      eventId: row.event_id,
      crewMemberId: row.crew_member_id,
      startsAt: row.order_events.starts_at,
      endsAt: row.order_events.ends_at,
      kind: row.order_events.kind,
      orderNumber: row.order_events.orders?.order_number ?? "—",
      projectName: row.order_events.orders?.project_name ?? null,
    }));
}
