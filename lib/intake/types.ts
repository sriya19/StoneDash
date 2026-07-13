// Shared shapes for the AI intake pipeline (Task 6C).
// Leaf module — no server-only or client-only guards — so client
// components (IntakeReviewSheet) and the server route can both
// import.

import { z } from "zod";

// The six primary request types the classifier picks between.
// Deterministic proposal dispatcher (Step C) branches on these.
export const INTAKE_REQUEST_TYPES = [
  "new_job",
  "repair",
  "scheduling",
  "question",
  "payment",
  "unclear",
] as const;
export type IntakeRequestType = (typeof INTAKE_REQUEST_TYPES)[number];

export const INTAKE_URGENCY_TIERS = [
  "asap",
  "soon",
  "flexible",
  "unclear",
] as const;
export type IntakeUrgency = (typeof INTAKE_URGENCY_TIERS)[number];

// ---------------------------------------------------------------------------
// Step A extraction shape
// ---------------------------------------------------------------------------
//
// The LLM writes to this shape via JSON schema output. Every field
// is nullable — an SMS screenshot that says "hey" produces mostly
// nulls, and the proposal step handles that gracefully. Two dates
// per requested date: `raw` (what the user actually said) + `iso`
// (LLM-resolved yyyy-MM-dd, validated server-side per PLAN Q9).

export type IntakeRequestedDate = {
  raw: string;
  iso: string | null; // yyyy-MM-dd; null when we couldn't validate
};

export type IntakeExtraction = {
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  request_type: IntakeRequestType;
  project_details: string | null;
  requested_dates: IntakeRequestedDate[];
  requested_action: string | null;
  urgency: IntakeUrgency;
  raw_transcript: string | null;
};

// Zod validator used at the API boundary. The LLM's json_schema
// output is already shape-locked but we double-parse defensively
// (models sometimes drift on nullability semantics).

const IsoDateNullable = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-MM-dd")
  .nullable();

const RequestedDate = z.object({
  raw: z.string(),
  iso: IsoDateNullable.optional().transform((v) => v ?? null),
});

export const IntakeExtractionSchema: z.ZodType<IntakeExtraction> = z.object({
  contact_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  request_type: z.enum(INTAKE_REQUEST_TYPES),
  project_details: z.string().nullable(),
  requested_dates: z.array(RequestedDate).default([]),
  requested_action: z.string().nullable(),
  urgency: z.enum(INTAKE_URGENCY_TIERS),
  raw_transcript: z.string().nullable(),
});
