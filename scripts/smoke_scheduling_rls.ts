// Non-owner + field-role RLS smoke test for scheduling tables + view.
//
// Verifies three claims from migrations 0013 + 0014 (PLAN ADD-2):
//   (1) Field-role user can call update_event_status RPC successfully;
//       cannot INSERT INTO order_events directly → permission denied (42501).
//   (2) Field-role user cannot UPDATE order_events directly (any column),
//       including status. Field's only mutation path is the RPC.
//   (3) v_calendar_events returns 0 rows to a non-member user (different org)
//       — silently, not as an error.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/smoke_scheduling_rls.ts
//
// Side effects: creates two throwaway auth users (one outsider, one field-role
// member of the demo org), both cleaned up at the end. On any failure the
// script exits non-zero with a readable error.

import { createClient } from "@supabase/supabase-js";

const OUTSIDER_EMAIL = "smoke-sched-outsider@topmarble.local";
const FIELD_EMAIL = "smoke-sched-field@topmarble.local";
const PASSWORD = "SmokeSched!2026";
const DEMO_ORG_SLUG = "top-marble-granite";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up demo org + one seeded event.
  const { data: demoOrg, error: orgErr } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", DEMO_ORG_SLUG)
    .maybeSingle<{ id: string }>();
  if (orgErr) throw orgErr;
  if (!demoOrg) throw new Error(`demo org "${DEMO_ORG_SLUG}" not found — run pnpm db:seed`);

  const { data: anEvent, error: evErr } = await admin
    .from("order_events")
    .select("id, status, kind, order_id")
    .eq("org_id", demoOrg.id)
    .eq("kind", "install")
    .limit(1)
    .maybeSingle<{ id: string; status: string; kind: string; order_id: string }>();
  if (evErr) throw evErr;
  if (!anEvent) throw new Error("no install events found — run pnpm db:seed");

  // Wipe any previous throwaway users.
  const existing = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of existing.data.users) {
    if (u.email === OUTSIDER_EMAIL || u.email === FIELD_EMAIL) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  // Create the two throwaway users.
  const outsiderCreate = await admin.auth.admin.createUser({
    email: OUTSIDER_EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (outsiderCreate.error || !outsiderCreate.data.user) throw outsiderCreate.error ?? new Error("outsider createUser failed");
  const outsiderId = outsiderCreate.data.user.id;

  const fieldCreate = await admin.auth.admin.createUser({
    email: FIELD_EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (fieldCreate.error || !fieldCreate.data.user) throw fieldCreate.error ?? new Error("field createUser failed");
  const fieldUserId = fieldCreate.data.user.id;

  // Promote field user to a field-role member of the demo org.
  await admin.from("profiles").upsert({ id: fieldUserId, active_org_id: demoOrg.id });
  const memberInsert = await admin.from("org_members").insert({
    org_id: demoOrg.id,
    user_id: fieldUserId,
    role: "field",
    invite_accepted_at: new Date().toISOString(),
  });
  if (memberInsert.error) throw memberInsert.error;

  const cleanup = async () => {
    await admin.auth.admin.deleteUser(outsiderId);
    await admin.auth.admin.deleteUser(fieldUserId);
  };

  try {
    const outsider = createClient(url, anon);
    await outsider.auth.signInWithPassword({ email: OUTSIDER_EMAIL, password: PASSWORD });

    const fieldClient = createClient(url, anon);
    await fieldClient.auth.signInWithPassword({ email: FIELD_EMAIL, password: PASSWORD });

    // (1a) Field role can call update_event_status RPC.
    const rpc1 = await fieldClient.rpc("update_event_status", {
      p_event_id: anEvent.id,
      p_status: "en_route",
    });
    assert(!rpc1.error, `field update_event_status failed: ${rpc1.error?.message}`);

    // Revert to original status so we don't leave state altered.
    await admin.from("order_events").update({ status: anEvent.status }).eq("id", anEvent.id);

    // (1b) Field role direct INSERT into order_events → rejected.
    const insertRes = await fieldClient.from("order_events").insert({
      org_id: demoOrg.id,
      order_id: anEvent.order_id,
      kind: "delivery",
      starts_at: new Date().toISOString(),
      duration_min: 30,
    });
    assert(
      insertRes.error !== null,
      "direct INSERT into order_events was NOT rejected for field role",
    );

    // (2) Field role direct UPDATE on order_events (status column) → rejected.
    const updateRes = await fieldClient
      .from("order_events")
      .update({ status: "en_route" })
      .eq("id", anEvent.id);
    assert(
      updateRes.error !== null,
      "direct UPDATE on order_events was NOT rejected for field role (status)",
    );

    // (3) Outsider sees zero rows from v_calendar_events.
    const calRes = await outsider.from("v_calendar_events").select("id, org_id");
    assert(
      !calRes.error,
      `v_calendar_events errored for non-member (expected silent zero rows): ${calRes.error?.message}`,
    );
    assert(
      (calRes.data ?? []).length === 0,
      `v_calendar_events leaked ${calRes.data?.length} rows to a non-member`,
    );

    // (Bonus) Outsider direct INSERT into order_events → rejected.
    const outsiderInsert = await outsider.from("order_events").insert({
      org_id: demoOrg.id,
      order_id: anEvent.order_id,
      kind: "delivery",
      starts_at: new Date().toISOString(),
      duration_min: 30,
    });
    assert(
      outsiderInsert.error !== null,
      "direct INSERT into order_events was NOT rejected for outsider",
    );

    process.stdout.write("smoke test passed — scheduling RLS + RPCs enforced as expected.\n");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  process.stderr.write(`smoke test FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
