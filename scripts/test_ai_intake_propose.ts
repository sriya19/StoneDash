// Unit-style test for Step C — the deterministic proposal
// dispatcher. Pure function, no DB or LLM needed. Covers the
// seven request_type × match combinations from the brief plus a
// few edge cases:
//   1. new_job + no customer match → create customer + create order
//   2. new_job + customer match    → create order for matched customer
//   3. repair + order match        → repair event + append note
//   4. repair + no order match     → create customer + quote order
//   5. scheduling + order match    → event + append note
//   6. scheduling + no order match → customer + order + event
//   7. payment                     → no_op
//   8. question                    → no_op
//   9. unclear                     → no_op
//  10. scheduling + order match but no resolved date → append note only
//  11. new_job + contact_name null → order only (no customer create)

import { propose } from "@/lib/intake/propose";
import type {
  IntakeExtraction,
  IntakeRequestType,
} from "@/lib/intake/types";
import type { IntakeMatches } from "@/lib/intake/match";

function makeExtraction(overrides: Partial<IntakeExtraction>): IntakeExtraction {
  return {
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    request_type: "unclear" as IntakeRequestType,
    project_details: null,
    requested_dates: [],
    requested_action: null,
    urgency: "unclear",
    raw_transcript: null,
    ...overrides,
  };
}

function noMatches(): IntakeMatches {
  const empty = { id: null, confidence: 0, tier: "none" as const, method: null };
  return {
    matched_customer: empty,
    matched_order: empty,
    matched_contractor: empty,
  };
}

function withMatches(overrides: Partial<IntakeMatches>): IntakeMatches {
  return { ...noMatches(), ...overrides };
}

const TZ = "America/New_York";

const checks: Array<[string, boolean, string]> = [];

function assert(name: string, ok: boolean, actual: string): void {
  checks.push([name, ok, actual]);
}

// 1. new_job + no customer match
{
  const p = propose(
    makeExtraction({
      request_type: "new_job",
      contact_name: "Alice",
      phone: "555-000-1111",
      project_details: "Kitchen counter",
    }),
    noMatches(),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  assert(
    "1. new_job + no customer → create_customer + create_order",
    types.length === 2 &&
      types[0] === "create_customer" &&
      types[1] === "create_order",
    JSON.stringify(types),
  );
}

// 2. new_job + customer match
{
  const p = propose(
    makeExtraction({
      request_type: "new_job",
      contact_name: "Alice",
      project_details: "Bar top",
    }),
    withMatches({
      matched_customer: { id: "cust-1", confidence: 1, tier: "high", method: "phone_exact" },
    }),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  assert(
    "2. new_job + customer match → create_order only",
    types.length === 1 && types[0] === "create_order",
    JSON.stringify(types),
  );
}

// 3. repair + order match
{
  const p = propose(
    makeExtraction({
      request_type: "repair",
      contact_name: "Bob",
      requested_dates: [{ raw: "Monday", iso: "2026-08-01" }],
    }),
    withMatches({
      matched_customer: { id: "cust-1", confidence: 1, tier: "high", method: "phone_exact" },
      matched_order: { id: "order-1", confidence: 0.9, tier: "high", method: "customer_link" },
    }),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  const eventAction = p.primary.find((a) => a.type === "create_event");
  assert(
    "3. repair + order match → repair event + append_note",
    types.includes("create_event") &&
      types.includes("append_note") &&
      eventAction?.type === "create_event" &&
      eventAction.kind === "repair",
    JSON.stringify(types),
  );
}

// 4. repair + no order match → new quote order
{
  const p = propose(
    makeExtraction({
      request_type: "repair",
      contact_name: "Charlie",
      phone: "555-222-3333",
      project_details: "Chipped edge on bathroom counter",
    }),
    noMatches(),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  const orderAction = p.primary.find((a) => a.type === "create_order");
  assert(
    "4. repair + no match → create_customer + create_order (stage=quote)",
    types.includes("create_customer") &&
      orderAction?.type === "create_order" &&
      orderAction.stage === "quote",
    JSON.stringify(types),
  );
}

// 5. scheduling + order match
{
  const p = propose(
    makeExtraction({
      request_type: "scheduling",
      contact_name: "Dana",
      requested_action: "confirm install for Friday",
      requested_dates: [{ raw: "Friday", iso: "2026-08-07" }],
      address: "48 Larchmont Ave, Vienna VA",
    }),
    withMatches({
      matched_customer: { id: "cust-1", confidence: 1, tier: "high", method: "phone_exact" },
      matched_order: { id: "order-1", confidence: 0.9, tier: "high", method: "customer_link" },
    }),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  const eventAction = p.primary.find((a) => a.type === "create_event");
  assert(
    "5. scheduling + order match → install event (auto-picked) + append_note",
    types.includes("create_event") &&
      types.includes("append_note") &&
      eventAction?.type === "create_event" &&
      eventAction.kind === "install",
    `${JSON.stringify(types)} kind=${eventAction?.type === "create_event" ? eventAction.kind : "?"}`,
  );
}

// 6. scheduling + no order match — full chain (customer + order + event)
{
  const p = propose(
    makeExtraction({
      request_type: "scheduling",
      contact_name: "Eve",
      phone: "555-777-8888",
      requested_action: "measurement next Tuesday",
      requested_dates: [{ raw: "next Tuesday", iso: "2026-08-11" }],
      address: "9 Maple St, Falls Church VA",
    }),
    noMatches(),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  const eventAction = p.primary.find((a) => a.type === "create_event");
  assert(
    "6. scheduling + no match → customer + order + event (kind=measurement)",
    types.length === 3 &&
      types.includes("create_customer") &&
      types.includes("create_order") &&
      eventAction?.type === "create_event" &&
      eventAction.kind === "measurement",
    JSON.stringify(types),
  );
}

// 7. payment → no_op
{
  const p = propose(
    makeExtraction({
      request_type: "payment",
      raw_transcript: "you still owe me for the invoice from March",
    }),
    noMatches(),
    TZ,
  );
  assert(
    "7. payment → no_op",
    p.primary.length === 1 && p.primary[0]?.type === "no_op",
    p.primary[0]?.type ?? "?",
  );
}

// 8. question → no_op
{
  const p = propose(
    makeExtraction({
      request_type: "question",
      raw_transcript: "how do I clean quartz?",
    }),
    noMatches(),
    TZ,
  );
  assert(
    "8. question → no_op",
    p.primary.length === 1 && p.primary[0]?.type === "no_op",
    p.primary[0]?.type ?? "?",
  );
}

// 9. unclear → no_op
{
  const p = propose(
    makeExtraction({ request_type: "unclear" }),
    noMatches(),
    TZ,
  );
  assert(
    "9. unclear → no_op",
    p.primary.length === 1 && p.primary[0]?.type === "no_op",
    p.primary[0]?.type ?? "?",
  );
}

// 10. scheduling + order match + no resolved date → append_note only
{
  const p = propose(
    makeExtraction({
      request_type: "scheduling",
      contact_name: "Frank",
      requested_action: "reschedule when you can",
    }),
    withMatches({
      matched_customer: { id: "cust-1", confidence: 1, tier: "high", method: "phone_exact" },
      matched_order: { id: "order-1", confidence: 0.9, tier: "high", method: "customer_link" },
    }),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  assert(
    "10. scheduling + order match + no date → append_note only (no event)",
    types.length === 1 && types[0] === "append_note",
    JSON.stringify(types),
  );
}

// 11. new_job + contact_name null → order only, no create_customer
{
  const p = propose(
    makeExtraction({
      request_type: "new_job",
      contact_name: null,
      project_details: "Kitchen remodel referral",
    }),
    noMatches(),
    TZ,
  );
  const types = p.primary.map((a) => a.type);
  assert(
    "11. new_job + null contact_name → create_order only (no customer create)",
    types.length === 1 && types[0] === "create_order",
    JSON.stringify(types),
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
