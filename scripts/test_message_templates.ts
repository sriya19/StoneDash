// Unit-style tests for the message template renderer. Pure functions —
// no DB, no network, no LLM.
//
// Coverage (PLAN.md Q5 lock):
//   1. happy path — every placeholder filled
//   2. all six shipped templates render with no leftover {{tokens}}
//   3. missing placeholder → empty string, reported in `missing`
//   4. empty placeholder → same treatment as missing
//   5. template injection — a value containing {{...}} is NOT re-expanded
//   6. HTML metacharacters survive byte-exact (we deliberately do not escape)
//   7. emoji and multi-byte characters survive byte-exact
//   8. newlines preserved; crew_dispatch keeps its line structure
//   9. dangling punctuation tidied when a placeholder is empty
//  10. placeholder matching is case-insensitive and whitespace-tolerant
//  11. templatePlaceholders() enumerates each token once, in order
//  12. digitsOnly() parity with the SQL digits_only() from 0019
//  13. deep-link builders return null when there is nothing to route to

import {
  renderTemplate,
  templatePlaceholders,
} from "@/lib/messaging/render-template";
import { SYSTEM_TEMPLATES } from "@/lib/messaging/system-templates";
import {
  digitsOnly,
  whatsAppLink,
  smsLink,
  emailLink,
} from "@/lib/messaging/phone";

const checks: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, actual: string) {
  checks.push([name, ok, actual]);
}

// A context covering every placeholder the six templates reference.
const FULL = {
  customer_name: "Sarah Chen",
  stone_type: "Calacatta Gold quartz",
  eta_min: "25",
  shop_phone: "(703) 555-0100",
  event_date: "Friday, Aug 28",
  event_time: "9:00 AM",
  event_datetime: "Friday, Aug 28 at 9:00 AM",
  event_duration: "3h",
  event_kind: "Install",
  order_number: "TM-1042",
  project_name: "Kitchen remodel",
  site_address: "48 Larchmont Ave, Vienna, VA",
  site_contact_name: "Sarah Chen",
  site_contact_phone: "(555) 201-3344",
  edge_profile: "Eased",
  cutout_summary: "1 sink, 1 cooktop",
  notes: "Gate code 4417",
  balance_due: "$2,480.00",
  fabrication_days: "10",
};

// 1. Happy path.
{
  const { text, missing } = renderTemplate(
    "Hi {{customer_name}}, ETA {{eta_min}} minutes.",
    FULL,
  );
  check(
    "1. happy path substitutes every placeholder",
    text === "Hi Sarah Chen, ETA 25 minutes." && missing.length === 0,
    JSON.stringify({ text, missing }),
  );
}

// 2. All shipped templates render cleanly against a full context.
{
  const leftovers: string[] = [];
  for (const t of SYSTEM_TEMPLATES) {
    const { text, missing } = renderTemplate(t.body, FULL);
    if (/\{\{|\}\}/.test(text)) leftovers.push(`${t.slug}: leftover token`);
    if (missing.length > 0) {
      leftovers.push(`${t.slug}: missing ${missing.join(",")}`);
    }
  }
  check(
    `2. all ${SYSTEM_TEMPLATES.length} system templates render with no leftover tokens`,
    leftovers.length === 0,
    leftovers.join(" | ") || "clean",
  );
}

// 3. Missing placeholder.
{
  const { text, missing } = renderTemplate("Call {{shop_phone}} today", {});
  check(
    "3. missing placeholder renders empty and is reported",
    text === "Call today" && missing.join(",") === "shop_phone",
    JSON.stringify({ text, missing }),
  );
}

// 4. Empty-string placeholder is treated as missing.
{
  const { text, missing } = renderTemplate("Call {{shop_phone}} today", {
    shop_phone: "",
  });
  check(
    "4. empty-string value treated as missing",
    text === "Call today" && missing.join(",") === "shop_phone",
    JSON.stringify({ text, missing }),
  );
}

// 5. Template injection — the real risk (PLAN.md Q5).
{
  const { text } = renderTemplate("Hi {{customer_name}}.", {
    customer_name: "{{shop_phone}}",
    shop_phone: "(703) 555-0100",
  });
  check(
    "5. value containing {{...}} is inserted literally, not re-expanded",
    text === "Hi {{shop_phone}}.",
    text,
  );
}

// 6. HTML metacharacters are NOT escaped.
{
  const { text } = renderTemplate("Hi {{customer_name}}.", {
    customer_name: `Ben & Jerry's <b>"quoted"</b>`,
  });
  check(
    "6. HTML metacharacters survive byte-exact (no escaping)",
    text === `Hi Ben & Jerry's <b>"quoted"</b>.`,
    text,
  );
}

// 7. Emoji / multi-byte.
{
  const { text } = renderTemplate("{{event_kind}} — {{notes}}", {
    event_kind: "📍 Install",
    notes: "Café · 北京 · 🪨",
  });
  check(
    "7. emoji and multi-byte characters survive byte-exact",
    text === "📍 Install — Café · 北京 · 🪨",
    text,
  );
}

// 8. Newlines preserved — crew_dispatch is a multi-line block.
{
  const dispatch = SYSTEM_TEMPLATES.find((t) => t.slug === "crew_dispatch")!;
  const { text } = renderTemplate(dispatch.body, FULL);
  const lines = text.split("\n");
  check(
    "8. crew_dispatch keeps its six-line structure",
    lines.length === 6 && lines[0]!.startsWith("📍"),
    JSON.stringify({ lineCount: lines.length, first: lines[0] }),
  );
}

// 9. Dangling punctuation is tidied when a placeholder is empty.
{
  const { text } = renderTemplate(
    "Any last questions call {{shop_phone}}.",
    {},
  );
  check(
    "9. dangling punctuation tidied to 'call.' not 'call .'",
    text === "Any last questions call.",
    text,
  );
}

// 10. Case-insensitive and whitespace-tolerant token matching.
{
  const { text } = renderTemplate("Hi {{ Customer_Name }}!", FULL);
  check(
    "10. token matching is case-insensitive and tolerates inner spaces",
    text === "Hi Sarah Chen!",
    text,
  );
}

// 11. templatePlaceholders enumeration.
{
  const found = templatePlaceholders(
    "{{a}} {{b}} {{a}} {{ C }}",
  );
  check(
    "11. templatePlaceholders lists each token once, in order",
    found.join(",") === "a,b,c",
    found.join(","),
  );
}

// 12. digitsOnly parity with SQL digits_only() from 0019. The right-hand
//     values are what the SQL function is known to return for these inputs
//     (see the collision-index tests in smoke_customer_collision.ts).
{
  const cases: Array<[string | null, string]> = [
    ["+1 (555) 123-4567", "15551234567"],
    ["5551234567", "5551234567"],
    ["555 201 3344", "5552013344"],
    ["(703) 555-0100", "7035550100"],
    ["", ""],
    [null, ""],
  ];
  const bad = cases.filter(([input, want]) => digitsOnly(input) !== want);
  check(
    "12. digitsOnly matches SQL digits_only() on known inputs",
    bad.length === 0,
    bad.map(([i, w]) => `${i} → want ${w} got ${digitsOnly(i)}`).join(" | ") ||
      "all match",
  );
}

// 13. Deep-link builders degrade to null rather than routing nowhere.
{
  const body = "hello & goodbye";
  const wa = whatsAppLink("(555) 201-3344", body);
  const sms = smsLink("(555) 201-3344", body);
  const mail = emailLink("sarah@example.com", body);
  const ok =
    wa === "https://wa.me/5552013344?text=hello%20%26%20goodbye" &&
    sms === "sms:5552013344?body=hello%20%26%20goodbye" &&
    mail?.startsWith("mailto:sarah%40example.com?body=") === true &&
    whatsAppLink(null, body) === null &&
    smsLink("", body) === null &&
    emailLink("   ", body) === null;
  check(
    "13. deep links encode the body and return null with no recipient",
    ok,
    JSON.stringify({ wa, sms, mail }),
  );
}

// 14. The two Task 9 stage-triggered templates exist, are customer-facing,
//     and say what the stage transition means. Pinned by slug because the
//     RPC in sub-step 3 looks them up by slug — a rename here would silently
//     stop the fabrication and invoice prompts from resolving a template.
{
  const problems: string[] = [];
  for (const [slug, needles] of [
    ["in_fabrication", ["{{stone_type}}", "{{fabrication_days}}"]],
    ["invoice_sent", ["{{project_name}}", "{{balance_due}}", "{{shop_phone}}"]],
  ] as const) {
    const t = SYSTEM_TEMPLATES.find((x) => x.slug === slug);
    if (!t) {
      problems.push(`${slug} missing`);
      continue;
    }
    if (t.audience !== "customer") problems.push(`${slug} audience=${t.audience}`);
    for (const n of needles) {
      if (!t.body.includes(n)) problems.push(`${slug} lacks ${n}`);
    }
    const { text, missing } = renderTemplate(t.body, FULL);
    if (missing.length > 0) problems.push(`${slug} unresolved ${missing.join(",")}`);
    if (/\{\{|\}\}/.test(text)) problems.push(`${slug} leftover token`);
  }
  check(
    "14. in_fabrication and invoice_sent render for a customer audience",
    problems.length === 0,
    problems.join(" | ") || "both clean",
  );
}

// Report.
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
