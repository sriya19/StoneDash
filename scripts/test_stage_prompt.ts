// Integration test for get_stage_notification_prompt (Task 9 sub-step 3).
//
// Hits the real RPC against the real database — the point is the SQL, so a
// mocked version would test nothing. Runs as service-role, which bypasses
// RLS; RLS itself is covered by the policy tests and is not what this
// exercises.
//
// Every fixture this creates is torn down in a finally block, including on
// failure. It creates ONLY stage_notification_prefs rows and one temporary
// history row — deliberately no customers or orders, because confirming an
// intake once already left mock personas in the demo org (TASK7-FOLLOWUP-03)
// and tests that write real entities are how that happens.
//
// Usage: pnpm smoke:notify

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  STAGE_NOTIFICATION_TRANSITIONS,
  stageNotificationTransition,
} from "@/lib/validators/orders";
import { renderTemplate } from "@/lib/messaging/render-template";
import { buildMessageContext } from "@/lib/messaging/build-context";

type Prompt = {
  should_prompt: boolean;
  reason: string;
  from_stage: string | null;
  to_stage: string;
  template_slug: string | null;
  template_body: string | null;
  recipient_kind: string;
  recipient_snapshot: Record<string, unknown> | null;
};

const checks: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, actual: string): void {
  checks.push([name, ok, actual]);
}

async function prompt(
  db: SupabaseClient,
  orderId: string,
  toStage: string,
  slug: string | null,
): Promise<Prompt> {
  const { data, error } = await db.rpc("get_stage_notification_prompt", {
    p_order_id: orderId,
    p_to_stage: toStage,
    p_default_template_slug: slug,
  });
  if (error) throw new Error(`rpc failed: ${error.message}`);
  const rows = data as Prompt[];
  if (!rows || rows.length !== 1) {
    throw new Error(`expected exactly 1 row, got ${rows?.length ?? 0}`);
  }
  return rows[0]!;
}

async function main(): Promise<void> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // A real order that has a customer with contact details.
  const { data: order } = await db
    .from("orders")
    .select("id, org_id, stage, customer_id, customers!inner(id, name, phone, email)")
    .not("customer_id", "is", null)
    .limit(1)
    .maybeSingle<{ id: string; org_id: string; stage: string; customer_id: string }>();
  if (!order) throw new Error("no order with a customer found — run pnpm db:seed");

  const TO = "fabrication";
  const FROM = "measurement";
  const DEFAULT_SLUG = "in_fabrication";
  const createdPrefIds: string[] = [];
  let historyId: string | null = null;

  try {
    // A history row is what the RPC reads from_stage out of. Insert the
    // transition we are testing so precedence has something to match on.
    const { data: hist, error: histErr } = await db
      .from("order_stage_history")
      .insert({ order_id: order.id, from_stage: FROM, to_stage: TO, note: "__TEST__ stage prompt" })
      .select("id")
      .single<{ id: string }>();
    if (histErr) throw new Error(`history insert: ${histErr.message}`);
    historyId = hist.id;

    // --- 1. no pref row = enabled (PLAN Q5) --------------------------------
    const p1 = await prompt(db, order.id, TO, DEFAULT_SLUG);
    check(
      "1. absent pref row means enabled, with slug, body and recipient",
      p1.should_prompt &&
        p1.reason === "ok" &&
        p1.from_stage === FROM &&
        p1.template_slug === DEFAULT_SLUG &&
        (p1.template_body?.length ?? 0) > 0 &&
        p1.recipient_kind === "customer" &&
        typeof p1.recipient_snapshot?.customer_id === "string",
      JSON.stringify({ reason: p1.reason, from: p1.from_stage, slug: p1.template_slug }),
    );

    // --- 2. the raw body renders through the real renderer ----------------
    const ctx = await buildMessageContext(db, { orderId: order.id });
    const rendered = renderTemplate(p1.template_body ?? "", ctx);
    check(
      "2. the RPC's raw body renders with no leftover tokens",
      !/\{\{|\}\}/.test(rendered.text) && rendered.missing.length === 0,
      JSON.stringify({ missing: rendered.missing, text: rendered.text.slice(0, 70) }),
    );

    // --- 3. a "from any stage" pref disables it ---------------------------
    const { data: anyPref } = await db
      .from("stage_notification_prefs")
      .insert({ org_id: order.org_id, from_stage: null, to_stage: TO, is_enabled: false })
      .select("id")
      .single<{ id: string }>();
    if (anyPref) createdPrefIds.push(anyPref.id);
    const p3 = await prompt(db, order.id, TO, DEFAULT_SLUG);
    check(
      "3. a from-any pref with is_enabled=false suppresses the prompt",
      !p3.should_prompt && p3.reason === "disabled_by_pref",
      JSON.stringify({ should: p3.should_prompt, reason: p3.reason }),
    );

    // --- 4. a specific pref outranks the from-any one ----------------------
    const { data: specPref } = await db
      .from("stage_notification_prefs")
      .insert({ org_id: order.org_id, from_stage: FROM, to_stage: TO, is_enabled: true })
      .select("id")
      .single<{ id: string }>();
    if (specPref) createdPrefIds.push(specPref.id);
    const p4 = await prompt(db, order.id, TO, DEFAULT_SLUG);
    check(
      "4. a specific from->to pref outranks a from-any pref",
      p4.should_prompt && p4.reason === "ok",
      JSON.stringify({ should: p4.should_prompt, reason: p4.reason }),
    );

    // --- 5. a template_slug override wins over the caller's default -------
    await db
      .from("stage_notification_prefs")
      .update({ template_slug: "payment_reminder" })
      .eq("id", specPref!.id);
    const p5 = await prompt(db, order.id, TO, DEFAULT_SLUG);
    check(
      "5. a pref template_slug override beats the caller's default",
      p5.should_prompt && p5.template_slug === "payment_reminder",
      JSON.stringify({ slug: p5.template_slug }),
    );

    // --- 6. a dangling override degrades, it does not open an empty modal --
    await db
      .from("stage_notification_prefs")
      .update({ template_slug: "no_such_template" })
      .eq("id", specPref!.id);
    const p6 = await prompt(db, order.id, TO, DEFAULT_SLUG);
    check(
      "6. a dangling template_slug yields template_not_found, not a blank body",
      !p6.should_prompt && p6.reason === "template_not_found",
      JSON.stringify({ should: p6.should_prompt, reason: p6.reason }),
    );

    // --- 7. terminal stages never prompt ----------------------------------
    const p7 = await prompt(db, order.id, "paid", "payment_reminder");
    check(
      "7. a terminal stage returns terminal_stage without erroring",
      !p7.should_prompt && p7.reason === "terminal_stage",
      JSON.stringify({ should: p7.should_prompt, reason: p7.reason }),
    );

    // --- 8. unknown order ---------------------------------------------------
    const p8 = await prompt(db, "00000000-0000-0000-0000-000000000000", TO, DEFAULT_SLUG);
    check(
      "8. an unknown order returns order_not_found rather than throwing",
      !p8.should_prompt && p8.reason === "order_not_found",
      JSON.stringify({ reason: p8.reason }),
    );

    // --- 9. a blank default slug is reported, not silently swallowed -------
    await db.from("stage_notification_prefs").delete().eq("id", specPref!.id);
    createdPrefIds.splice(createdPrefIds.indexOf(specPref!.id), 1);
    await db.from("stage_notification_prefs").delete().eq("id", anyPref!.id);
    createdPrefIds.splice(createdPrefIds.indexOf(anyPref!.id), 1);
    const p9 = await prompt(db, order.id, TO, "   ");
    check(
      "9. a blank default slug reports no_template_configured",
      !p9.should_prompt && p9.reason === "no_template_configured",
      JSON.stringify({ reason: p9.reason }),
    );

    // --- 10. the TS map and the RPC agree on every shipped transition -----
    const disagreements: string[] = [];
    for (const t of STAGE_NOTIFICATION_TRANSITIONS) {
      const resolved = stageNotificationTransition(t.from, t.to);
      if (resolved?.templateSlug !== t.templateSlug) {
        disagreements.push(`${t.from}->${t.to}`);
      }
      const { data: tpl } = await db
        .from("message_templates")
        .select("slug")
        .eq("org_id", order.org_id)
        .eq("slug", t.templateSlug)
        .maybeSingle();
      if (!tpl) disagreements.push(`${t.templateSlug} not seeded`);
    }
    check(
      `10. all ${STAGE_NOTIFICATION_TRANSITIONS.length} transitions resolve to a seeded template`,
      disagreements.length === 0,
      disagreements.join(", ") || "all resolve",
    );
  } finally {
    for (const id of createdPrefIds) {
      await db.from("stage_notification_prefs").delete().eq("id", id);
    }
    if (historyId) {
      await db.from("order_stage_history").delete().eq("id", historyId);
    }
  }

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
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`stage prompt test FAILED: ${msg}\n`);
  process.exit(1);
});
