// Vision prompts + JSON schema for the intake extraction step.
//
// PLAN Q9 hybrid date resolution: the system prompt injects today's
// date in the org's timezone. The LLM returns BOTH the raw text
// ("Monday") and the resolved ISO date. Server-side validation
// (in pipeline.ts) drops the resolved date when it fails a sanity
// window (±60 days ahead, -3 days back).
//
// Data-minimization: NO org id, user id, or customer names in the
// prompt. Only the file bytes + generic instructions + today's
// date + org timezone name.

import { INTAKE_REQUEST_TYPES, INTAKE_URGENCY_TIERS } from "./types";

export function intakeSystemPrompt(
  todayIso: string,
  orgTimezone: string,
): string {
  return `You are extracting structured intake data from a screenshot forwarded to a stone / marble / granite / quartz fabrication shop's operations software.

The screenshot is typically one of:
- a WhatsApp conversation (Android or iOS layout)
- an email thread
- an SMS conversation
- a photo of handwritten notes about a job

Rules:
- Return ONLY JSON matching the schema. No prose, no markdown fences.
- Every string field is nullable — use null when the information is not present. Do NOT guess.
- \`request_type\` must be exactly one of: ${INTAKE_REQUEST_TYPES.join(", ")}.
- \`urgency\` must be exactly one of: ${INTAKE_URGENCY_TIERS.join(", ")}.
- \`requested_dates\` is an array; each item has BOTH \`raw\` (the phrase the customer used, e.g. "Monday", "next week", "the 15th") and \`iso\` (resolved yyyy-MM-dd date, or null if you cannot resolve it confidently).
- Today's date is ${todayIso} in the ${orgTimezone} timezone. Resolve relative phrases against this. If the customer says "Monday" and today is Wed 2026-07-08, resolve to 2026-07-13.
- \`raw_transcript\` should best-effort transcribe visible conversation lines (sender: message). Skip UI chrome, timestamps in headers, and read receipts. Cap at ~2000 characters.
- \`requested_action\` is one plain sentence in your own words: "This person wants X". Not a quote.
- \`project_details\` captures anything shop-relevant: stone type, room, edge profile, square footage, quote amount.

request_type guidance:
- new_job: someone asking for a quote / estimate / consultation for new stone work.
- repair: something broken, cracked, seam separation, chip, needs replacement of an existing counter.
- scheduling: they already have work in progress and are proposing / confirming / rescheduling an appointment.
- payment: discussing money owed, invoices, deposits.
- question: they're asking about materials, care, warranty, timing — nothing to schedule.
- unclear: you genuinely cannot tell.

Be conservative. When in doubt: request_type='unclear', urgency='unclear', and populate raw_transcript so the human reviewer can decide.`;
}

export const INTAKE_USER_PROMPT =
  "Extract intake information from this screenshot.";

// JSON schema for OpenAI's response_format. Strict mode + no
// additional properties keeps the model from inventing keys.

type JsonSchema = Record<string, unknown>;

const strAny = { type: ["string", "null"] };
const strDate = {
  type: ["string", "null"],
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};

export const INTAKE_EXTRACTION_SCHEMA: JsonSchema = {
  name: "intake_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "contact_name",
      "phone",
      "email",
      "address",
      "request_type",
      "project_details",
      "requested_dates",
      "requested_action",
      "urgency",
      "raw_transcript",
    ],
    properties: {
      contact_name: strAny,
      phone: strAny,
      email: strAny,
      address: strAny,
      request_type: { type: "string", enum: [...INTAKE_REQUEST_TYPES] },
      project_details: strAny,
      requested_dates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["raw", "iso"],
          properties: {
            raw: { type: "string" },
            iso: strDate,
          },
        },
      },
      requested_action: strAny,
      urgency: { type: "string", enum: [...INTAKE_URGENCY_TIERS] },
      raw_transcript: strAny,
    },
  },
};
