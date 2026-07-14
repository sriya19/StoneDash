// Real-API smoke for the Task 6C intake extraction step. Runs
// THREE GPT-4o calls against the three synthetic fixtures per
// user Q13 refinement, asserts per-fixture request_type +
// matching-shape + proposal-shape, logs cumulative cost_cents.
// Budget: ~15¢ total.
//
// Skips gracefully when OPENAI_API_KEY is missing — the fixtures
// still tell you if the pipeline shape is intact, but the real
// model call needs the key.
//
// Explicit caveat carried in DEVLOG sub-step 11: a synthetic
// HTML-rendered PNG is NOT the same as a real WhatsApp
// screenshot. This smoke verifies the pipeline's happy paths;
// real accuracy is the shop's usage.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

// Not routed through the /api/intake/[intakeId] endpoint because
// we don't want to seed rows for this — the smoke calls the
// pipeline module directly with the fixture bytes.
import { runStepA } from "@/lib/intake/pipeline";
import { runMatches } from "@/lib/intake/match";
import { propose } from "@/lib/intake/propose";

type FixtureCase = {
  name: string;
  file: string;
  expectedRequestType: string;
  // Assertion callback — receives the pipeline result and returns
  // { ok, notes } per check. Runs after Step A returns.
  assertions: (result: {
    extraction: import("@/lib/intake/types").IntakeExtraction;
    matches: import("@/lib/intake/match").IntakeMatches;
    proposal: import("@/lib/intake/propose").Proposal;
  }) => Array<[label: string, ok: boolean, actual: string]>;
};

const FIXTURES: FixtureCase[] = [
  {
    name: "whatsapp-new-job",
    file: "whatsapp-new-job.png",
    expectedRequestType: "new_job",
    assertions: ({ extraction, matches, proposal }) => [
      [
        "extraction.request_type = new_job",
        extraction.request_type === "new_job",
        String(extraction.request_type),
      ],
      [
        "matched_customer = null (Amelia isn't seeded)",
        matches.matched_customer.id === null,
        String(matches.matched_customer.id),
      ],
      [
        "proposal includes create_customer",
        proposal.primary.some((a) => a.type === "create_customer"),
        proposal.primary.map((a) => a.type).join(","),
      ],
      [
        "proposal includes create_order",
        proposal.primary.some((a) => a.type === "create_order"),
        proposal.primary.map((a) => a.type).join(","),
      ],
    ],
  },
  {
    name: "email-scheduling-matches-seed",
    file: "email-scheduling-matches-seed.png",
    expectedRequestType: "scheduling",
    assertions: ({ extraction, matches, proposal }) => [
      [
        "extraction.request_type = scheduling",
        extraction.request_type === "scheduling",
        String(extraction.request_type),
      ],
      [
        // The seeded demo customer "Sarah Chen" should match.
        "matched_customer resolves to a seeded customer",
        matches.matched_customer.id !== null &&
          matches.matched_customer.tier !== "none",
        `id=${matches.matched_customer.id} tier=${matches.matched_customer.tier}`,
      ],
      [
        "proposal is non-empty",
        proposal.primary.length > 0,
        String(proposal.primary.length),
      ],
    ],
  },
  {
    name: "sms-ambiguous",
    file: "sms-ambiguous.png",
    expectedRequestType: "unclear|question",
    assertions: ({ extraction, proposal }) => [
      [
        "extraction.request_type is unclear or question",
        extraction.request_type === "unclear" ||
          extraction.request_type === "question",
        String(extraction.request_type),
      ],
      [
        "proposal is just no_op",
        proposal.primary.length === 1 && proposal.primary[0]?.type === "no_op",
        proposal.primary.map((a) => a.type).join(","),
      ],
    ],
  },
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    process.stdout.write(
      "intake real-API smoke: skipping — OPENAI_API_KEY not set.\n",
    );
    process.exit(0);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: org } = await supabase
    .from("organizations")
    .select("id, timezone")
    .eq("slug", "top-marble-granite")
    .single<{ id: string; timezone: string }>();
  if (!org) throw new Error("demo org missing — pnpm db:seed first");

  const todayIso = new Date().toISOString().slice(0, 10);
  const fixturesDir = path.resolve(process.cwd(), "test/fixtures");

  let totalCost = 0;
  const checks: Array<[string, boolean, string]> = [];

  for (const fx of FIXTURES) {
    const filePath = path.join(fixturesDir, fx.file);
    const bytes = new Uint8Array(await readFile(filePath));

    process.stdout.write(`\n=== ${fx.name} ===\n`);
    const stepA = await runStepA(bytes, "image/png", {
      todayIso,
      orgTimezone: org.timezone,
    });
    totalCost += stepA.costCents;
    process.stdout.write(
      `Step A: ${stepA.costCents}¢ · request_type=${stepA.extraction.request_type} · urgency=${stepA.extraction.urgency}\n`,
    );

    const matches = await runMatches(supabase, org.id, stepA.extraction);
    const proposal = propose(stepA.extraction, matches, org.timezone);

    for (const [label, ok, actual] of fx.assertions({
      extraction: stepA.extraction,
      matches,
      proposal,
    })) {
      checks.push([`${fx.name}: ${label}`, ok, actual]);
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
  process.stdout.write(`total real-API cost: ${totalCost}¢\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `intake real-API smoke FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
