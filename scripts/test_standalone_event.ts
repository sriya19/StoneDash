// Integration test for standalone events (Task 3.1 sub-step 2).
//
// What we're verifying via the actual RPCs (not direct table writes):
//   1. create_order_event with p_order_id=NULL + p_title='...' succeeds.
//   2. The resulting row has order_id IS NULL and title set.
//   3. The view returns is_standalone=true and order_number IS NULL.
//   4. update_order_event preserves title across an unrelated change
//      (kind / location).
//   5. delete_order_event cleans up.
//
// Sign-in flow matches test_event_reschedule.ts: anon client signs in as
// the demo owner (the RPCs are SECURITY DEFINER and require a non-null
// auth.uid()).

import { createClient } from "@supabase/supabase-js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sb = createClient(url, anon);
  const { error: signinErr } = await sb.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (signinErr) throw signinErr;

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString(); // +2d
  const title = `__standalone_test__ ${Date.now()}`;

  // 1. Create a standalone task event.
  const { data: createData, error: createErr } = await sb.rpc("create_order_event", {
    p_order_id: null,
    p_kind: "task",
    p_starts_at: startsAt,
    p_duration_min: 30,
    p_location_text: null,
    p_notes: "Test standalone event",
    p_assignments: [],
    p_title: title,
    p_is_all_day: false,
  });
  if (createErr || typeof createData !== "string") {
    throw createErr ?? new Error("create_order_event returned no id");
  }
  const eventId = createData;

  try {
    // 2. Direct row shape: order_id NULL, title set, kind='task'.
    const { data: row } = await admin
      .from("order_events")
      .select("id, order_id, title, kind, is_all_day, duration_min")
      .eq("id", eventId)
      .maybeSingle<{
        id: string;
        order_id: string | null;
        title: string | null;
        kind: string;
        is_all_day: boolean;
        duration_min: number;
      }>();
    assert(row, "event row missing");
    assert(row.order_id === null, `order_id should be NULL, got ${String(row.order_id)}`);
    assert(row.title === title, `title mismatch: ${String(row.title)} vs ${title}`);
    assert(row.kind === "task", `kind mismatch: ${row.kind}`);
    assert(row.is_all_day === false, "is_all_day should be false");
    assert(row.duration_min === 30, `duration_min should be 30, got ${row.duration_min}`);

    // 3. View row: is_standalone=true, order_number IS NULL, title flowed
    //    through via COALESCE(o.project_name, e.title).
    const { data: viewRow } = await admin
      .from("v_calendar_events")
      .select("id, title, is_standalone, order_number, customer_name")
      .eq("id", eventId)
      .maybeSingle<{
        id: string;
        title: string | null;
        is_standalone: boolean;
        order_number: string | null;
        customer_name: string | null;
      }>();
    assert(viewRow, "view row missing");
    assert(viewRow.is_standalone === true, "is_standalone should be true");
    assert(viewRow.order_number === null, `order_number should be NULL, got ${viewRow.order_number}`);
    assert(viewRow.customer_name === null, `customer_name should be NULL`);
    assert(viewRow.title === title, `view title mismatch: ${viewRow.title}`);

    // 4. update_order_event with a different kind — title must be
    //    preserved (since we pass it back through).
    const { error: updErr } = await sb.rpc("update_order_event", {
      p_event_id: eventId,
      p_kind: "pickup",
      p_starts_at: startsAt,
      p_duration_min: 30,
      p_location_text: "Test location after update",
      p_notes: "Updated note",
      p_assignments: [],
      p_title: title,
      p_is_all_day: false,
    });
    if (updErr) throw updErr;

    const { data: updated } = await admin
      .from("order_events")
      .select("title, kind, location_text")
      .eq("id", eventId)
      .maybeSingle<{ title: string | null; kind: string; location_text: string | null }>();
    assert(updated?.title === title, `title wiped on update: ${String(updated?.title)}`);
    assert(updated?.kind === "pickup", `kind not updated: ${updated?.kind}`);
    assert(
      updated?.location_text === "Test location after update",
      `location not updated: ${String(updated?.location_text)}`,
    );

    // 5. Standalone update with empty title must FAIL — friendly RPC error.
    const { error: emptyTitleErr } = await sb.rpc("update_order_event", {
      p_event_id: eventId,
      p_kind: "task",
      p_starts_at: startsAt,
      p_duration_min: 30,
      p_location_text: null,
      p_notes: null,
      p_assignments: [],
      p_title: "",
      p_is_all_day: false,
    });
    assert(
      emptyTitleErr !== null,
      "expected RPC to reject empty title on standalone event, got success",
    );
  } finally {
    // 6. Cleanup.
    await sb.rpc("delete_order_event", { p_event_id: eventId });
  }

  process.stdout.write(
    "standalone-event integration test passed — create / view / update preserve title.\n",
  );
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
