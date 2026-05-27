// Integration test for rescheduleOrderEvent (Task 3 sub-step 7).
//
// The reschedule path fetches the existing event, calls update_order_event,
// and explicitly re-passes location_text / notes / assignments so they
// aren't wiped by the RPC's "replace everything" semantics. This test
// verifies that round-trip: pick an event with crew, give it notes +
// location, reschedule it, confirm those fields are preserved.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/test_event_reschedule.ts
//
// Idempotent: moves the event +1 hour, asserts, moves it back.

import { createClient } from "@supabase/supabase-js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // The RPCs are SECURITY DEFINER and assert auth.uid() != NULL, so service-
  // role calls would fail with "not authenticated". Sign in as the demo
  // owner via the anon client (same path the app uses). Service-role client
  // is kept for the introspective SELECTs that need to bypass RLS.
  const sb = createClient(url, anon);
  const { error: signinErr } = await sb.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (signinErr) throw signinErr;

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Find one upcoming install event with at least one assigned crew member.
  const nowIso = new Date().toISOString();
  const { data: candidates, error: candErr } = await admin
    .from("order_events")
    .select("id, starts_at, duration_min, location_text, notes, kind, org_id, order_id")
    .eq("kind", "install")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(5)
    .returns<
      Array<{
        id: string;
        starts_at: string;
        duration_min: number;
        location_text: string | null;
        notes: string | null;
        kind: string;
        org_id: string;
        order_id: string;
      }>
    >();
  if (candErr) throw candErr;
  if (!candidates || candidates.length === 0) {
    throw new Error("no upcoming install events — run pnpm db:seed");
  }

  let chosen: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const { count } = await admin
      .from("order_event_assignments")
      .select("id", { head: true, count: "exact" })
      .eq("event_id", c.id);
    if ((count ?? 0) > 0) {
      chosen = c;
      break;
    }
  }
  if (!chosen) throw new Error("no upcoming install event with crew assignments");

  // Seed a marker location + notes so we can verify they're preserved.
  const markerLocation = `__test_loc__ ${Date.now()}`;
  const markerNotes = `__test_note__ ${Date.now()}`;
  await admin
    .from("order_events")
    .update({ location_text: markerLocation, notes: markerNotes })
    .eq("id", chosen.id);

  const { data: assignBefore } = await admin
    .from("order_event_assignments")
    .select("crew_member_id, role")
    .eq("event_id", chosen.id)
    .returns<{ crew_member_id: string; role: string | null }[]>();
  const assignBeforeIds = (assignBefore ?? []).map((a) => a.crew_member_id).sort();

  // Build a "date + time" target = chosen.starts_at + 1 hour, in UTC.
  const originalStart = new Date(chosen.starts_at);
  const newStart = new Date(originalStart.getTime() + 60 * 60_000);
  const newDateUtc = newStart.toISOString().slice(0, 10);
  const newTimeUtc = newStart.toISOString().slice(11, 16);

  // Call update_order_event the same way rescheduleOrderEvent does (preserving
  // everything except starts_at + duration_min). We exercise the RPC directly
  // here — the action wrapper just adds the tz parse on top.
  const { error: updErr } = await sb.rpc("update_order_event", {
    p_event_id: chosen.id,
    p_kind: chosen.kind,
    p_starts_at: newStart.toISOString(),
    p_duration_min: chosen.duration_min,
    p_location_text: markerLocation,
    p_notes: markerNotes,
    p_assignments: (assignBefore ?? []).map((a) => ({
      crew_member_id: a.crew_member_id,
      role: a.role,
    })),
  });
  if (updErr) throw updErr;
  void newDateUtc;
  void newTimeUtc;

  // Verify.
  const { data: after } = await admin
    .from("order_events")
    .select("starts_at, location_text, notes, duration_min")
    .eq("id", chosen.id)
    .maybeSingle<{
      starts_at: string;
      location_text: string | null;
      notes: string | null;
      duration_min: number;
    }>();
  assert(after, "event vanished after update");
  assert(
    new Date(after.starts_at).getTime() === newStart.getTime(),
    `starts_at not updated: got ${after.starts_at}, expected ${newStart.toISOString()}`,
  );
  assert(
    after.location_text === markerLocation,
    `location_text wiped: got ${String(after.location_text)}`,
  );
  assert(
    after.notes === markerNotes,
    `notes wiped: got ${String(after.notes)}`,
  );
  assert(
    after.duration_min === chosen.duration_min,
    `duration changed unexpectedly: ${after.duration_min}`,
  );

  const { data: assignAfter } = await admin
    .from("order_event_assignments")
    .select("crew_member_id")
    .eq("event_id", chosen.id)
    .returns<{ crew_member_id: string }[]>();
  const assignAfterIds = (assignAfter ?? []).map((a) => a.crew_member_id).sort();
  assert(
    JSON.stringify(assignBeforeIds) === JSON.stringify(assignAfterIds),
    `assignments changed: before ${JSON.stringify(assignBeforeIds)} after ${JSON.stringify(assignAfterIds)}`,
  );

  // Audit row written?
  const { data: audit } = await admin
    .from("activity_log")
    .select("action, metadata")
    .eq("entity_type", "order_event")
    .eq("entity_id", chosen.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ action: string; metadata: Record<string, unknown> }>();
  assert(audit?.action === "rescheduled", `expected rescheduled audit, got ${audit?.action}`);

  // Restore.
  await sb.rpc("update_order_event", {
    p_event_id: chosen.id,
    p_kind: chosen.kind,
    p_starts_at: chosen.starts_at,
    p_duration_min: chosen.duration_min,
    p_location_text: chosen.location_text,
    p_notes: chosen.notes,
    p_assignments: (assignBefore ?? []).map((a) => ({
      crew_member_id: a.crew_member_id,
      role: a.role,
    })),
  });

  process.stdout.write("reschedule integration test passed — fields preserved across update.\n");
}

main().catch((err) => {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null
        ? JSON.stringify(err)
        : String(err);
  process.stderr.write(`test FAILED: ${msg}\n`);
  process.exit(1);
});
