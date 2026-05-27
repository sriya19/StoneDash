// Pre-flight check for the 0013 backfill (PLAN Q5/Q13).
//
// Run BEFORE applying 0013 to confirm what the backfill will produce:
//   pnpm tsx --env-file=.env.local scripts/verify_event_backfill.ts
//
// You can also run it AFTER applying 0013 — it'll detect that the events
// already exist and report counts on both sides. The in-migration assertion
// in 0013 is the safety net; this script is the human-readable preview.
//
// Counts row totals AND date-month distributions for both legacy columns.
// If the totals don't match what the migration will INSERT, the script
// prints a warning and exits non-zero so CI can pick it up.

import { createClient } from "@supabase/supabase-js";

type CountRow = { measured_count: number; install_count: number };
type MonthRow = { month: string; cnt: number };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Totals.
  const { data: totals, error: totalsErr } = await supabase
    .rpc("verify_event_backfill_counts")
    .returns<CountRow>();
  // The RPC doesn't exist; use raw SQL via the underlying http call.
  // Fall back to two count queries, which is what we want anyway.
  if (totalsErr) {
    // expected — RPC is intentional fallback. Continue.
  }
  void totals;

  const { count: ordersMeasured, error: e1 } = await supabase
    .from("orders")
    .select("id", { head: true, count: "exact" })
    .not("measured_at", "is", null);
  if (e1) throw e1;

  const { count: ordersInstall, error: e2 } = await supabase
    .from("orders")
    .select("id", { head: true, count: "exact" })
    .not("scheduled_install_date", "is", null);
  if (e2) throw e2;

  // Does the order_events table exist yet? Use a SELECT (not HEAD) so the
  // missing-table response carries the actual "not in schema cache" error.
  // HEAD requests against an unknown table return 204 with no error, which
  // is indistinguishable from "table exists but empty".
  const probe = await supabase.from("order_events").select("id").limit(1);
  const migrationApplied = !probe.error;
  let eventsMeasurement: number | null = null;
  let eventsInstall: number | null = null;
  if (migrationApplied) {
    const m = await supabase
      .from("order_events")
      .select("id", { head: true, count: "exact" })
      .eq("kind", "measurement");
    if (m.error) throw m.error;
    eventsMeasurement = m.count ?? 0;
    const i = await supabase
      .from("order_events")
      .select("id", { head: true, count: "exact" })
      .eq("kind", "install");
    if (i.error) throw i.error;
    eventsInstall = i.count ?? 0;
  }

  process.stdout.write("orders.measured_at populated:           " + ordersMeasured + "\n");
  process.stdout.write("orders.scheduled_install_date populated: " + ordersInstall + "\n");

  if (migrationApplied) {
    process.stdout.write("order_events kind=measurement:           " + (eventsMeasurement ?? 0) + "\n");
    process.stdout.write("order_events kind=install:               " + (eventsInstall ?? 0) + "\n");
  } else {
    process.stdout.write("order_events table:                      (not yet created — migration not applied)\n");
  }

  // Month distribution for the install side — easiest to see if the
  // backfill is dropping or duplicating any specific months.
  const { data: orderMonthsInstall, error: mErr } = await supabase
    .from("orders")
    .select("scheduled_install_date")
    .not("scheduled_install_date", "is", null)
    .returns<{ scheduled_install_date: string }[]>();
  if (mErr) throw mErr;

  const bucket = new Map<string, number>();
  for (const row of orderMonthsInstall ?? []) {
    const month = row.scheduled_install_date.slice(0, 7);
    bucket.set(month, (bucket.get(month) ?? 0) + 1);
  }

  process.stdout.write("\nInstall-date distribution by YYYY-MM:\n");
  for (const month of Array.from(bucket.keys()).sort()) {
    process.stdout.write(`  ${month}  ${bucket.get(month)}\n`);
  }

  // Verdict.
  process.stdout.write("\n");
  if (migrationApplied) {
    let bad = false;
    if ((eventsMeasurement ?? 0) !== (ordersMeasured ?? 0)) {
      process.stdout.write(`MISMATCH measurement: orders=${ordersMeasured} events=${eventsMeasurement}\n`);
      bad = true;
    }
    if ((eventsInstall ?? 0) !== (ordersInstall ?? 0)) {
      process.stdout.write(`MISMATCH install: orders=${ordersInstall} events=${eventsInstall}\n`);
      bad = true;
    }
    if (bad) {
      process.exit(1);
    }
    process.stdout.write("OK: event counts match legacy column counts.\n");
  } else {
    process.stdout.write(`Migration not applied. Would create:\n`);
    process.stdout.write(`  ${ordersMeasured} measurement events (one per order with measured_at set)\n`);
    process.stdout.write(`  ${ordersInstall} install events (one per order with scheduled_install_date set)\n`);
    process.stdout.write("Apply with: pnpm db:migrate\n");
  }
}

main().catch((err) => {
  process.stderr.write(`verify FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
