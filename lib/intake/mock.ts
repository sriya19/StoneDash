// Mock fixtures for MOCK_AI mode + the intake smoke.
// Three fixtures covering the three primary paths that sub-step 7's
// dispatcher needs to exercise:
//   whatsapp_new_job          — new customer, new job
//   scheduling_matches         — request matching a seeded order
//   unclear                    — vague message, no writes
// The mock skips only Step A (the LLM call). Steps B (matching) and
// C (proposal) always run — they're pure local logic the pipeline
// should exercise even in mock mode (PLAN Q8 lock).

import type { IntakeExtraction } from "./types";

export type IntakeMockKey =
  | "whatsapp_new_job"
  | "scheduling_matches"
  | "unclear";

const FIXTURES: Record<IntakeMockKey, IntakeExtraction> = {
  whatsapp_new_job: {
    contact_name: "Amelia Ross",
    phone: "(555) 411-8823",
    email: null,
    address: "48 Larchmont Ave, Vienna, VA",
    request_type: "new_job",
    project_details:
      "Kitchen remodel — Calacatta Gold quartz, single sink cutout, eased edge, approx 42 sqft.",
    requested_dates: [
      // The pipeline validates iso against today; the mock returns
      // a date 10 days in the future so a "measure appointment"
      // downstream action wouldn't fail the validity window.
      { raw: "next Monday", iso: mockDateNDaysFromToday(10) },
    ],
    requested_action:
      "Amelia wants a quote for a kitchen countertop replacement and would like to schedule a measurement visit next week.",
    urgency: "soon",
    raw_transcript:
      "Amelia: Hi! We just closed on a house in Vienna and need to redo the kitchen counters. Do you have Calacatta Gold quartz in stock?\nOwner: Yes, we do. When were you thinking?\nAmelia: Would you be able to come measure next Monday? 48 Larchmont Ave, Vienna VA.\nOwner: Let me check the schedule and get back to you.",
  },
  scheduling_matches: {
    // Seed uses "Sarah Chen" as one of the demo customers on order
    // TM-1046. Pipeline's matching step will hit that on lower(name)
    // trigram similarity.
    contact_name: "Sarah Chen",
    phone: null,
    email: null,
    address: null,
    request_type: "scheduling",
    project_details: "Kitchen island install",
    requested_dates: [
      { raw: "this Friday morning", iso: mockDateNDaysFromToday(5) },
    ],
    requested_action:
      "Sarah wants to confirm the install for her kitchen island this Friday morning.",
    urgency: "soon",
    raw_transcript:
      "Sarah: Just confirming — Friday morning still good for the install?\nSarah: The kids will be at school so 9 or 10 works.",
  },
  unclear: {
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    request_type: "unclear",
    project_details: null,
    requested_dates: [],
    requested_action: null,
    urgency: "unclear",
    raw_transcript: "hey quick q about my counters",
  },
};

/** Persona fields the intake smoke overrides to stay collision-proof. */
export type MockPersonaOverride = {
  contact_name?: string;
  phone?: string;
};

/**
 * The fixture personas are fixed names — which means that once someone
 * confirms a mock intake through /intake, `apply_intake` creates a real
 * customer with that identity and Step B legitimately starts matching it.
 * Any assertion that depends on "this persona is unknown" then goes red on
 * a database people actually use.
 *
 * `persona` lets a caller (in practice, scripts/smoke_intake_pipeline.ts)
 * substitute a unique per-run identity so matching can never collide with
 * real records. It is honoured in mock mode only.
 */
export function mockIntakeExtraction(
  key: IntakeMockKey = "whatsapp_new_job",
  persona?: MockPersonaOverride,
): IntakeExtraction {
  const fixture = FIXTURES[key];
  if (!persona || (!persona.contact_name && !persona.phone)) return fixture;
  return {
    ...fixture,
    contact_name: persona.contact_name ?? fixture.contact_name,
    phone: persona.phone ?? fixture.phone,
  };
}

export function isMockKey(v: string | null | undefined): v is IntakeMockKey {
  return (
    v === "whatsapp_new_job" ||
    v === "scheduling_matches" ||
    v === "unclear"
  );
}

// Return yyyy-MM-dd for today + N days in UTC — good enough for a
// fixture; the pipeline's downstream date validation is timezone-
// aware and only checks the ±60/-3 day window, not the hour.
function mockDateNDaysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
