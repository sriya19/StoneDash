// Step A orchestrator for the intake pipeline.
//
// Reuses Task 5's OpenAI wrapper (single-call chat completions
// with json_schema output) and cost math. Runs GPT-4o vision on
// the screenshot; downstream steps (B: matching, C: proposal) are
// pure local logic and live in their own modules — always run,
// even in mock mode.

import "server-only";

import { callChatCompletions } from "@/lib/extraction/openai";
import { toDataUrl } from "@/lib/extraction/pipeline";
import {
  IntakeExtractionSchema,
  type IntakeExtraction,
} from "./types";
import { INTAKE_EXTRACTION_SCHEMA, INTAKE_USER_PROMPT, intakeSystemPrompt } from "./prompts";

export type StepAResult = {
  extraction: IntakeExtraction;
  raw: { content: string; usage: { input: number; output: number } };
  costCents: number;
};

// Data-minimization guard: we pass the file bytes + generic
// instructions + today's date + org timezone. Nothing else.
export async function runStepA(
  fileBytes: Uint8Array,
  mime: string,
  ctx: { todayIso: string; orgTimezone: string },
): Promise<StepAResult> {
  const dataUrl = toDataUrl(fileBytes, mime);

  const result = await callChatCompletions({
    model: "gpt-4o",
    system: intakeSystemPrompt(ctx.todayIso, ctx.orgTimezone),
    userContent: [
      { type: "text", text: INTAKE_USER_PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
    jsonSchema: INTAKE_EXTRACTION_SCHEMA,
  });

  // Defensive parse — json_schema output should already conform,
  // but a model drift or spec drift would silently produce a bad
  // shape. Zod catches it before it hits the DB.
  const parsed = safeParseExtraction(result.content);
  if (!parsed.ok) {
    throw new Error(`Intake extraction shape invalid: ${parsed.error}`);
  }

  // PLAN Q9: resolved iso dates get a sanity window. LLM
  // hallucinates dates confidently sometimes; the window catches
  // "resolved 'yesterday' to 2019-04-01" or similar drift.
  const cleaned = clampResolvedDates(parsed.value);

  return {
    extraction: cleaned,
    raw: { content: result.content, usage: result.usage },
    costCents: result.costCents,
  };
}

function safeParseExtraction(
  content: string,
):
  | { ok: true; value: IntakeExtraction }
  | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "JSON parse failed" };
  }
  const result = IntakeExtractionSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "shape mismatch" };
  }
  return { ok: true, value: result.data };
}

// Drop iso when it falls outside a plausibility window relative to
// today. Retain the raw text so the review sheet can still surface
// it — the user then picks a real date.
const AHEAD_DAYS = 60;
const BEHIND_DAYS = 3;
function clampResolvedDates(ext: IntakeExtraction): IntakeExtraction {
  const now = Date.now();
  const cleaned = ext.requested_dates.map((d) => {
    if (!d.iso) return d;
    const parsed = new Date(`${d.iso}T09:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return { ...d, iso: null };
    const diffDays = (parsed.getTime() - now) / (1000 * 60 * 60 * 24);
    if (diffDays > AHEAD_DAYS || diffDays < -BEHIND_DAYS) {
      return { ...d, iso: null };
    }
    return d;
  });
  return { ...ext, requested_dates: cleaned };
}
