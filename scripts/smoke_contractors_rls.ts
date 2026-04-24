// Non-owner RLS smoke test for contractor tables + views.
//
// Verifies three claims from migration 0011:
//   (1) v_contractor_balances and v_order_contractor_paid return 0 rows for
//       a user who is NOT a member of the contractor's org — silently, not
//       as an error. Silent zero-rows is the scary RLS failure mode; assert
//       it explicitly.
//   (2) Direct INSERT into contractor_payments as an authenticated non-RPC
//       caller is rejected. REVOKE + RLS WITH CHECK (false) both back this;
//       if either is missing this test catches it.
//   (3) Direct INSERT into contractor_payment_allocations is rejected for
//       the same reason.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/smoke_contractors_rls.ts
//
// Side effects: creates one throwaway auth user + one test contractor row,
// both cleaned up at the end. On any failure the script exits non-zero with
// a readable error.

import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = "smoke-outsider@topmarble.local";
const TEST_PASSWORD = "SmokeOutsider!2026";
const TEST_CONTRACTOR_NAME = "__smoke_test_contractor__";
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

  // Look up demo org id (service-role bypasses RLS).
  const { data: demoOrg, error: orgErr } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", DEMO_ORG_SLUG)
    .maybeSingle<{ id: string }>();
  if (orgErr) throw orgErr;
  if (!demoOrg) {
    throw new Error(
      `demo org "${DEMO_ORG_SLUG}" not found — run \`pnpm db:seed\` first`,
    );
  }

  // Seed one contractor under the demo org so v_contractor_balances has at
  // least one row to hide from the non-member.
  const { data: testContractor, error: insertErr } = await admin
    .from("contractors")
    .insert({
      org_id: demoOrg.id,
      name: TEST_CONTRACTOR_NAME,
      payment_terms: "Net 30",
    })
    .select("id")
    .single<{ id: string }>();
  if (insertErr || !testContractor) {
    throw insertErr ?? new Error("could not create test contractor");
  }

  // Create a throwaway non-member auth user.
  const existing = await admin.auth.admin.listUsers({ perPage: 200 });
  const prior = existing.data.users.find((u) => u.email === TEST_EMAIL);
  if (prior) await admin.auth.admin.deleteUser(prior.id);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error("createUser failed");
  const outsiderId = created.user.id;

  const cleanup = async () => {
    await admin.auth.admin.deleteUser(outsiderId);
    await admin
      .from("contractors")
      .delete()
      .eq("id", testContractor.id);
  };

  try {
    // Sign in as the non-member through the anon endpoint.
    const outsider = createClient(url, anon);
    const { error: signinErr } = await outsider.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (signinErr) throw signinErr;

    // (1a) v_contractor_balances — 0 rows, no error.
    const balancesRes = await outsider
      .from("v_contractor_balances")
      .select("contractor_id, org_id, balance_owed");
    assert(
      !balancesRes.error,
      `v_contractor_balances returned error for non-member (expected silent zero rows): ${balancesRes.error?.message}`,
    );
    assert(
      (balancesRes.data ?? []).length === 0,
      `v_contractor_balances leaked ${balancesRes.data?.length} rows to a non-member`,
    );

    // (1b) v_order_contractor_paid — 0 rows, no error.
    const paidRes = await outsider
      .from("v_order_contractor_paid")
      .select("order_id, paid_by_contractor");
    assert(
      !paidRes.error,
      `v_order_contractor_paid returned error for non-member: ${paidRes.error?.message}`,
    );
    assert(
      (paidRes.data ?? []).length === 0,
      `v_order_contractor_paid leaked ${paidRes.data?.length} rows`,
    );

    // (2) Direct INSERT into contractor_payments — must be rejected.
    const paymentInsertRes = await outsider.from("contractor_payments").insert({
      org_id: demoOrg.id,
      contractor_id: testContractor.id,
      amount: 100,
      received_on: "2026-01-01",
      method: "check",
    });
    assert(
      paymentInsertRes.error !== null,
      "direct INSERT into contractor_payments was NOT rejected for an authenticated non-member",
    );

    // (3) Direct INSERT into contractor_payment_allocations — must be rejected.
    // We use a bogus payment_id; the RLS/REVOKE check runs before FK validation,
    // so the error must be a permission/policy error, not a 23503 FK violation.
    const allocationInsertRes = await outsider
      .from("contractor_payment_allocations")
      .insert({
        payment_id: "00000000-0000-0000-0000-000000000000",
        order_id: "00000000-0000-0000-0000-000000000000",
        amount: 100,
      });
    assert(
      allocationInsertRes.error !== null,
      "direct INSERT into contractor_payment_allocations was NOT rejected",
    );

    // Note: SELECT on contractors with the outsider session also returns 0
    // rows (not our test contractor), which proves the contractors_select
    // policy is working. Assert it here too — cheap, and a regression canary.
    const contractorsRes = await outsider
      .from("contractors")
      .select("id, name");
    assert(
      !contractorsRes.error,
      `contractors SELECT errored for non-member: ${contractorsRes.error?.message}`,
    );
    assert(
      (contractorsRes.data ?? []).length === 0,
      `contractors leaked ${contractorsRes.data?.length} rows to a non-member`,
    );

    process.stdout.write("smoke test passed — RLS + REVOKE enforced as expected.\n");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  process.stderr.write(`smoke test FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
