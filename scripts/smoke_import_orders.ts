// End-to-end smoke for POST /api/import/orders. Pre-seeds a customer
// + contractor so the by-name resolution has something to match.
//
// Five-row CSV exercising the full handler:
//   1. Valid row with everything (custom stage + flexible date) — inserts.
//   2. Valid row, no contractor name — inserts; contractor_id null.
//   3. Valid row with a misspelled contractor — inserts WITH WARNING;
//      contractor_id null.
//   4. Customer name not found in org — skipped with warning.
//   5. Garbage install date — inserts WITH WARNING; date null.
//
// Expected response: inserted=4, skipped=1, warnings contains at least
// one "contractor … not found", one "customer … not found", and one
// "couldn't parse install date".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

const CUST_PREFIX = "__SMOKE_ORDERS_CUST__";
const CONTR_PREFIX = "__SMOKE_ORDERS_CONTR__";
const PROJECT_PREFIX = "__SMOKE_ORDERS_PROJ__";

async function signIn(jar: CookieJar): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (next) => {
        for (const { name, value } of next) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
}

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cleanup(): Promise<void> {
  const sb = admin();
  // Delete orders by project_name prefix (they're scoped to the test).
  await sb.from("orders").delete().ilike("project_name", `${PROJECT_PREFIX}%`);
  await sb.from("contractors").delete().ilike("name", `${CONTR_PREFIX}%`);
  await sb.from("customers").delete().ilike("name", `${CUST_PREFIX}%`);
}

async function seed(): Promise<{ orgId: string }> {
  const sb = admin();
  const { data: org } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", "top-marble-granite")
    .single<{ id: string }>();
  if (!org) throw new Error("demo org missing");

  await sb.from("customers").insert([
    { org_id: org.id, name: `${CUST_PREFIX}Alice` },
    { org_id: org.id, name: `${CUST_PREFIX}Bob` },
  ]);
  await sb.from("contractors").insert([
    { org_id: org.id, name: `${CONTR_PREFIX}Apex Builders` },
  ]);

  return { orgId: org.id };
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set (cleanup needs it)");
  }

  await cleanup();
  await seed();

  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  const csv =
    "Customer,Project,Contractor,Stage,Quote,Install Date\n" +
    // 1. Everything valid; flexible date format
    `${CUST_PREFIX}Alice,${PROJECT_PREFIX}Kitchen Reno,${CONTR_PREFIX}Apex Builders,fabrication,"$12,500.00",07/15/2026\n` +
    // 2. No contractor
    `${CUST_PREFIX}Alice,${PROJECT_PREFIX}Bath Vanity,,quote,2500,2026-08-01\n` +
    // 3. Mistyped contractor → warns, imports without
    `${CUST_PREFIX}Bob,${PROJECT_PREFIX}Island,${CONTR_PREFIX}Apxe Bldrs,measurement,"$8,000",Jul 20 2026\n` +
    // 4. Customer not found → skipped
    `Unknown Person,${PROJECT_PREFIX}Ghost,,,1000,2026-07-01\n` +
    // 5. Garbage date → warns, imports without date
    `${CUST_PREFIX}Bob,${PROJECT_PREFIX}Bar Top,,,3500,sometime next month\n`;

  const mapping = {
    Customer: "customerName",
    Project: "projectName",
    Contractor: "contractorName",
    Stage: "stage",
    Quote: "quoteAmount",
    "Install Date": "scheduledInstallDate",
  };

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "orders.csv");
  form.append("mapping", JSON.stringify(mapping));

  const res = await fetch(`${devUrl}/api/import/orders`, {
    method: "POST",
    body: form,
    headers: { Cookie: cookieHeader },
  });

  if (res.status !== 200) {
    process.stderr.write(`FAIL: HTTP ${res.status}\n${await res.text()}\n`);
    await cleanup();
    process.exit(1);
  }

  const body = (await res.json()) as {
    ok: boolean;
    inserted: number;
    skipped: number;
    warnings: string[];
  };

  const checks: Array<[string, boolean, string]> = [
    ["ok", body.ok === true, String(body.ok)],
    ["inserted=4", body.inserted === 4, String(body.inserted)],
    ["skipped=1", body.skipped === 1, String(body.skipped)],
    [
      "warning: contractor not found",
      body.warnings.some((w) =>
        /contractor "?.*Apxe Bldrs"? not found/i.test(w),
      ),
      JSON.stringify(body.warnings),
    ],
    [
      "warning: customer not found",
      body.warnings.some((w) => w.toLowerCase().includes("customer") && w.toLowerCase().includes("not found")),
      JSON.stringify(body.warnings),
    ],
    [
      "warning: bad install date",
      body.warnings.some((w) => w.toLowerCase().includes("couldn't parse install date")),
      JSON.stringify(body.warnings),
    ],
  ];

  // Verify DB state: 4 orders should exist with our project-name prefix;
  // exactly one should be linked to the contractor; exactly two should
  // have install dates set; stage should round-trip on row 1.
  const sb = admin();
  const { data: rows, error } = await sb
    .from("orders")
    .select("project_name, stage, contractor_id, scheduled_install_date")
    .ilike("project_name", `${PROJECT_PREFIX}%`);
  if (error) {
    process.stderr.write(`db read failed: ${error.message}\n`);
    await cleanup();
    process.exit(1);
  }
  checks.push([
    "DB has 4 inserted orders",
    (rows?.length ?? 0) === 4,
    String(rows?.length ?? 0),
  ]);
  checks.push([
    "1 row links contractor",
    (rows ?? []).filter((r) => r.contractor_id !== null).length === 1,
    String((rows ?? []).filter((r) => r.contractor_id !== null).length),
  ]);
  checks.push([
    "2 rows have install date",
    (rows ?? []).filter((r) => r.scheduled_install_date !== null).length === 2,
    String((rows ?? []).filter((r) => r.scheduled_install_date !== null).length),
  ]);
  checks.push([
    "kitchen row stage = fabrication",
    (rows ?? []).some(
      (r) =>
        r.project_name === `${PROJECT_PREFIX}Kitchen Reno` &&
        r.stage === "fabrication",
    ),
    JSON.stringify((rows ?? []).map((r) => [r.project_name, r.stage])),
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name} = ${actual}\n`);
      failed += 1;
    }
  }

  process.stdout.write(`\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`);
  await cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`import-orders smoke FAILED: ${msg}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
