// Integration tests for lib/messaging/build-context.ts against the seeded DB.
//
// Creates its own fixtures under a __CTX__ prefix and removes them after, so
// it never depends on — or disturbs — seed or application data. Every
// identity is unique per run for the reason recorded in TODO.md
// TASK7-FOLLOWUP-01/-02: confirming an intake writes real customer rows, so
// a fixed fixture identity eventually collides with data someone created.
//
// Coverage (PLAN.md sub-step 3):
//   1. customer only — names, stone, cutouts, balance, address fallback
//   2. site_contact_* on the order overrides the customer
//   3. order with a contractor — contractor_name populated
//   4. standalone event (no order) — order-derived keys empty, no throw
//   5. all-day event — event_time renders "All day", duration follows
//   6. event.location_text wins over the customer address (Q6 precedence)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildMessageContext } from "@/lib/messaging/build-context";

const PREFIX = "__CTX__";
const RUN_STAMP = String(Date.now());
const uniq = (label: string) => `${PREFIX}${label}_${RUN_STAMP}`;

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function cleanup(sb: SupabaseClient): Promise<void> {
  // order_events cascade from orders; delete orders first, then the
  // standalone events this test made, then customers and contractors.
  await sb.from("order_events").delete().ilike("title", `${PREFIX}%`);
  await sb.from("orders").delete().ilike("project_name", `${PREFIX}%`);
  await sb.from("customers").delete().ilike("name", `${PREFIX}%`);
  await sb.from("contractors").delete().ilike("name", `${PREFIX}%`);
}

const checks: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, actual: string) {
  checks.push([name, ok, actual]);
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  const sb = admin();
  await cleanup(sb);

  const { data: org } = await sb
    .from("organizations")
    .select("id, timezone, currency, phone")
    .eq("slug", "top-marble-granite")
    .single<{ id: string; timezone: string; currency: string; phone: string | null }>();
  if (!org) throw new Error("demo org missing — run pnpm db:seed");

  // Give the org a phone so {{shop_phone}} has a value to resolve. Restore
  // whatever was there afterwards so the test leaves no trace.
  const originalPhone = org.phone;
  const testPhone = "(703) 555-0100";
  await sb.from("organizations").update({ phone: testPhone }).eq("id", org.id);

  try {
    // ---- Fixtures -------------------------------------------------------
    const { data: customer } = await sb
      .from("customers")
      .insert({
        org_id: org.id,
        name: uniq("Dana Reyes"),
        phone: "(555) 999-1001",
        email: "dana@example.test",
        address_line1: "12 Quarry Rd",
        city: "Vienna",
        state: "VA",
        postal_code: "22182",
      })
      .select("id, name")
      .single<{ id: string; name: string }>();
    if (!customer) throw new Error("customer fixture failed");

    const { data: contractor } = await sb
      .from("contractors")
      .insert({ org_id: org.id, name: uniq("Ridgeline Builders"), phone: "(555) 999-2002" })
      .select("id, name")
      .single<{ id: string; name: string }>();
    if (!contractor) throw new Error("contractor fixture failed");

    // Order A — customer only, no site contact, no contractor.
    const { data: orderA } = await sb
      .from("orders")
      .insert({
        org_id: org.id,
        order_number: `CTX-${RUN_STAMP.slice(-6)}A`,
        customer_id: customer.id,
        project_name: uniq("Kitchen"),
        stone_type: "Calacatta Gold quartz",
        edge_profile: "Eased",
        sink_cutouts: 1,
        cooktop_cutouts: 2,
        // balance_due is derived by tg_compute_balance_due (migration 0004)
        // as quote_amount - deposit_received; setting it directly is
        // silently overwritten. Drive it through the inputs instead.
        quote_amount: 3000,
        deposit_received: 520,
      })
      .select("id")
      .single<{ id: string }>();
    if (!orderA) throw new Error("orderA fixture failed");

    // Order B — site contact override + contractor.
    const { data: orderB } = await sb
      .from("orders")
      .insert({
        org_id: org.id,
        order_number: `CTX-${RUN_STAMP.slice(-6)}B`,
        customer_id: customer.id,
        contractor_id: contractor.id,
        project_name: uniq("Bath"),
        stone_type: "Carrara",
        edge_profile: "Bullnose",
        sink_cutouts: 1,
        cooktop_cutouts: 0,
        balance_due: 0,
        site_contact_name: "Marcus Webb",
        site_contact_phone: "(555) 999-3003",
        site_contact_email: "marcus@example.test",
      })
      .select("id")
      .single<{ id: string }>();
    if (!orderB) throw new Error("orderB fixture failed");

    // Timed install event on order A, with its own location.
    const { data: eventA } = await sb
      .from("order_events")
      .insert({
        org_id: org.id,
        order_id: orderA.id,
        kind: "install",
        title: uniq("EventA"),
        starts_at: "2026-09-04T14:00:00Z",
        duration_min: 180,
        location_text: "48 Larchmont Ave, Vienna, VA",
        notes: "Gate code 4417",
      })
      .select("id")
      .single<{ id: string }>();
    if (!eventA) throw new Error("eventA fixture failed");

    // Standalone all-day task — no order at all.
    const { data: eventStandalone } = await sb
      .from("order_events")
      .insert({
        org_id: org.id,
        order_id: null,
        kind: "task",
        title: uniq("Trade show"),
        starts_at: "2026-09-10T04:00:00Z",
        duration_min: 1440,
        is_all_day: true,
      })
      .select("id")
      .single<{ id: string }>();
    if (!eventStandalone) throw new Error("standalone fixture failed");

    // ---- 1. Customer only ----------------------------------------------
    const c1 = await buildMessageContext(sb, { eventId: eventA.id });
    check(
      "1. customer-only order populates name, stone, cutouts, balance, shop phone",
      c1.customer_name === customer.name &&
        c1.stone_type === "Calacatta Gold quartz" &&
        c1.cutout_summary === "1 sink cutout, 2 cooktop cutouts" &&
        c1.balance_due === "$2,480.00" &&
        c1.shop_phone === testPhone,
      JSON.stringify({
        customer_name: c1.customer_name,
        cutout_summary: c1.cutout_summary,
        balance_due: c1.balance_due,
        shop_phone: c1.shop_phone,
      }),
    );

    // Task 9: {{fabrication_days}} resolves from the org column, not a
    // per-order value, and is always a bare number — the renderer's
    // empty-placeholder tidy cannot rescue "typical fabrication is  days",
    // so an empty string here would ship a broken sentence.
    check(
      "1c. fabrication_days resolves from the org and is a positive integer",
      // TemplateContext values are `string | null | undefined` by type, so
      // the ?? "" is not defensive noise — it is what makes an absent key
      // FAIL the digits check rather than throw.
      /^\d+$/.test(c1.fabrication_days ?? "") &&
        Number(c1.fabrication_days ?? 0) > 0,
      JSON.stringify({ fabrication_days: c1.fabrication_days }),
    );

    // With no site contact set, the customer is the fallback.
    check(
      "1b. site_contact falls back to the customer when unset",
      c1.site_contact_name === customer.name &&
        c1.site_contact_phone === "(555) 999-1001",
      JSON.stringify({
        name: c1.site_contact_name,
        phone: c1.site_contact_phone,
      }),
    );

    // ---- 2. Site contact override --------------------------------------
    const c2 = await buildMessageContext(sb, { orderId: orderB.id });
    check(
      "2. order site_contact_* overrides the customer",
      c2.site_contact_name === "Marcus Webb" &&
        c2.site_contact_phone === "(555) 999-3003" &&
        c2.customer_name === customer.name,
      JSON.stringify({
        site: c2.site_contact_name,
        customer: c2.customer_name,
      }),
    );

    // ---- 3. Contractor --------------------------------------------------
    check(
      "3. order with a contractor populates contractor_name",
      c2.contractor_name === contractor.name &&
        c2.contractor_phone === "(555) 999-2002",
      JSON.stringify({ name: c2.contractor_name, phone: c2.contractor_phone }),
    );

    // ---- 4. Standalone event -------------------------------------------
    const c4 = await buildMessageContext(sb, { eventId: eventStandalone.id });
    check(
      "4. standalone event leaves order-derived keys empty without throwing",
      c4.order_number === "" &&
        c4.stone_type === "" &&
        c4.balance_due === "" &&
        c4.customer_name === "" &&
        c4.event_kind === "Task" &&
        c4.project_name === `${PREFIX}Trade show_${RUN_STAMP}`,
      JSON.stringify({
        order_number: c4.order_number,
        balance_due: c4.balance_due,
        event_kind: c4.event_kind,
        project_name: c4.project_name,
      }),
    );

    // ---- 5. All-day rendering ------------------------------------------
    check(
      "5. all-day event renders event_time 'All day' and duration to match",
      c4.event_time === "All day" &&
        c4.event_duration === "All day" &&
        (c4.event_datetime ?? "").includes("(all day)"),
      JSON.stringify({
        time: c4.event_time,
        duration: c4.event_duration,
        datetime: c4.event_datetime,
      }),
    );

    // A timed event still formats normally — 14:00Z is 10:00 AM in ET.
    check(
      "5b. timed event formats time and duration in the org timezone",
      c1.event_time === "10:00 AM" && c1.event_duration === "3h",
      JSON.stringify({ time: c1.event_time, duration: c1.event_duration }),
    );

    // ---- 6. Address precedence (Q6) -------------------------------------
    check(
      "6. event.location_text wins over the composed customer address",
      c1.site_address === "48 Larchmont Ave, Vienna, VA" &&
        c2.site_address === "12 Quarry Rd, Vienna, VA 22182",
      JSON.stringify({ withEvent: c1.site_address, orderOnly: c2.site_address }),
    );
  } finally {
    await sb
      .from("organizations")
      .update({ phone: originalPhone })
      .eq("id", org.id);
    await cleanup(sb);
  }
}

main()
  .then(() => {
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
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`context test FAILED: ${msg}\n`);
    process.exit(1);
  });
