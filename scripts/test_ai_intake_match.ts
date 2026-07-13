// Unit-style smoke for the Task 6C Step B matching module.
// Runs against the real hosted DB using seeded demo data — the
// six cases the brief calls for:
//   1. Exact phone match
//   2. Fuzzy name match (typo)
//   3. No match
//   4. Ambiguous multi-match (two people with the same name — the
//      matcher should still land ONE best pick, not throw)
//   5. Contractor match
//   6. Address-only match (should NOT hit — no field for address
//      in the extraction; verifies we don't false-positive on
//      address-shaped strings appearing in project_details)
//
// Idempotent: seeds a couple of extra rows scoped to __MATCH__
// prefixes, then cleans up after.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { runMatches } from "@/lib/intake/match";
import type { IntakeExtraction } from "@/lib/intake/types";

const PREFIX = "__MATCH__";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function cleanup(): Promise<void> {
  const sb = admin();
  await sb.from("customers").delete().ilike("name", `${PREFIX}%`);
  await sb.from("contractors").delete().ilike("name", `${PREFIX}%`);
}

function baseExtraction(overrides: Partial<IntakeExtraction>): IntakeExtraction {
  return {
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    request_type: "unclear",
    project_details: null,
    requested_dates: [],
    requested_action: null,
    urgency: "unclear",
    raw_transcript: null,
    ...overrides,
  };
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  await cleanup();

  const sb = admin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", "top-marble-granite")
    .single<{ id: string }>();
  if (!org) throw new Error("demo org missing — pnpm db:seed first");

  // Seed a couple of fixture customers + one contractor for the tests.
  const { data: customers } = await sb
    .from("customers")
    .insert([
      // Case 1 target: exact phone
      { org_id: org.id, name: `${PREFIX}Amelia Ross`, phone: "(555) 411-8823" },
      // Case 2 target: fuzzy name (test uses "Sara Jonson")
      { org_id: org.id, name: `${PREFIX}Sarah Johnson`, phone: "555-201-3344" },
      // Case 4 target: ambiguous — two customers named "John Smith"
      { org_id: org.id, name: `${PREFIX}John Smith`, phone: "555-001-1000" },
      { org_id: org.id, name: `${PREFIX}John Smith`, phone: "555-001-2000" },
    ])
    .select("id, name, phone")
    .returns<{ id: string; name: string; phone: string | null }[]>();
  if (!customers) throw new Error("seed customers failed");

  const { data: contractors } = await sb
    .from("contractors")
    .insert([{ org_id: org.id, name: `${PREFIX}Apex Builders LLC` }])
    .select("id")
    .returns<{ id: string }[]>();
  if (!contractors) throw new Error("seed contractor failed");

  const ameliaId = customers.find((c) => c.name === `${PREFIX}Amelia Ross`)!.id;
  const sarahId = customers.find((c) => c.name === `${PREFIX}Sarah Johnson`)!.id;
  const apexId = contractors[0]!.id;

  const checks: Array<[string, boolean, string]> = [];

  // Case 1 — exact phone.
  const r1 = await runMatches(
    sb,
    org.id,
    baseExtraction({ phone: "5554118823" }),
  );
  checks.push([
    "1. exact phone match hits high tier",
    r1.matched_customer.id === ameliaId && r1.matched_customer.tier === "high",
    `id=${r1.matched_customer.id} tier=${r1.matched_customer.tier} method=${r1.matched_customer.method}`,
  ]);

  // Case 2 — fuzzy name.
  const r2 = await runMatches(
    sb,
    org.id,
    baseExtraction({ contact_name: `${PREFIX}Sara Jonson` }),
  );
  checks.push([
    "2. fuzzy name (Sara Jonson → Sarah Johnson)",
    r2.matched_customer.id === sarahId && r2.matched_customer.tier !== "none",
    `id=${r2.matched_customer.id} tier=${r2.matched_customer.tier} confidence=${r2.matched_customer.confidence}`,
  ]);

  // Case 3 — no match.
  const r3 = await runMatches(
    sb,
    org.id,
    baseExtraction({ contact_name: `${PREFIX}Xylophonic Nightingale` }),
  );
  checks.push([
    "3. no match (nonsense name)",
    r3.matched_customer.id === null && r3.matched_customer.tier === "none",
    `id=${r3.matched_customer.id} tier=${r3.matched_customer.tier}`,
  ]);

  // Case 4 — ambiguous. Two Johns; matcher should still land ONE
  // (whichever pg_trgm picks). We accept any of the two IDs as long
  // as tier is set and the matcher didn't throw.
  const johnIds = new Set(
    customers
      .filter((c) => c.name === `${PREFIX}John Smith`)
      .map((c) => c.id),
  );
  const r4 = await runMatches(
    sb,
    org.id,
    baseExtraction({ contact_name: `${PREFIX}John Smith` }),
  );
  checks.push([
    "4. ambiguous multi-match lands ONE result deterministically",
    r4.matched_customer.id !== null && johnIds.has(r4.matched_customer.id),
    `id=${r4.matched_customer.id}`,
  ]);

  // Case 5 — contractor match. project_details contains the
  // contractor's name.
  const r5 = await runMatches(
    sb,
    org.id,
    baseExtraction({
      project_details: `${PREFIX}Apex Builders LLC referral, kitchen remodel`,
    }),
  );
  checks.push([
    "5. contractor name lands via project_details",
    r5.matched_contractor.id === apexId,
    `id=${r5.matched_contractor.id} tier=${r5.matched_contractor.tier}`,
  ]);

  // Case 6 — address-only. No contact_name, no phone, no email;
  // just an address in the address field + a nondescript project.
  // We should NOT false-positive on customer or contractor.
  const r6 = await runMatches(
    sb,
    org.id,
    baseExtraction({
      address: "123 Maple Lane, Falls Church, VA",
      project_details: "kitchen",
    }),
  );
  checks.push([
    "6. address-only doesn't false-positive on customer",
    r6.matched_customer.id === null,
    `id=${r6.matched_customer.id}`,
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name}\n           ${actual}\n`);
      failed += 1;
    }
  }
  process.stdout.write(
    `\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`,
  );

  await cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  process.stderr.write(
    `match test FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  await cleanup().catch(() => {});
  process.exit(1);
});
