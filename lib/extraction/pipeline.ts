// Two-step extraction pipeline: classify with gpt-4o-mini, extract
// with gpt-4o if the class is supported. PLAN Q9 lock — full
// cost math is per-call.
//
// Callers pass the file's bytes + mime type. We do NOT pass any
// StoneDash-internal identifiers to the model — the LLM sees the
// document contents and the generic prompts, nothing else.
//
// No "server-only" guard: same reasoning as ./openai — pure
// plumbing over caller-provided bytes. Safe from Node scripts.

import { callChatCompletions } from "./openai";
import {
  CLASSIFIER_SYSTEM,
  CLASSIFIER_USER,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
} from "./prompts";
import {
  isSupportedType,
  type ExtractionResult,
  type SupportedDocumentType,
} from "./types";
import type {
  ExtractionConfidence,
  ExtractionDocumentType,
} from "@/lib/supabase/types";

type ClassifierResponse = {
  type: ExtractionDocumentType;
  confidence: ExtractionConfidence;
};

type ExtractionResponse = {
  confidence: ExtractionConfidence;
  fields: Record<string, unknown>;
};

// Data URLs work everywhere the Chat Completions image_url content
// accepts (images) AND PDF via the same content-part shape per the
// PLAN Q3 lock. If the caller can't produce a data URL, they should
// wrap the file bytes here first.
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// The public entry point. Returns an ExtractionResult regardless of
// whether the extraction path ran — an `other` classification skips
// the second call and returns fields={} with cost from just the
// classifier.
export async function runExtractionPipeline(
  fileDataUrl: string,
): Promise<ExtractionResult> {
  // Step 1 — classify.
  const classify = await callChatCompletions({
    model: "gpt-4o-mini",
    system: CLASSIFIER_SYSTEM,
    userContent: [
      { type: "text", text: CLASSIFIER_USER },
      { type: "image_url", image_url: { url: fileDataUrl } },
    ],
  });

  const classification = parseClassifier(classify.content);
  let cumulativeCost = classify.costCents;

  if (!isSupportedType(classification.type)) {
    return {
      document_type: classification.type,
      confidence: classification.confidence,
      fields: {},
      raw: {
        classifier: {
          content: classify.content,
          usage: classify.usage,
        },
      },
      cost_cents: cumulativeCost,
    };
  }

  // Step 2 — extract structured fields.
  const type = classification.type as SupportedDocumentType;
  const extract = await callChatCompletions({
    model: "gpt-4o",
    system: EXTRACTION_SYSTEM[type],
    userContent: [
      { type: "text", text: "Extract the required fields from this document." },
      { type: "image_url", image_url: { url: fileDataUrl } },
    ],
    jsonSchema: EXTRACTION_SCHEMA[type],
  });
  cumulativeCost += extract.costCents;

  const extraction = parseExtraction(extract.content);

  return {
    document_type: type,
    // Confidence: take the *lower* of the classifier's and the
    // extractor's self-assessment. If the classifier was unsure the
    // extraction can't be more sure than that.
    confidence: minConfidence(classification.confidence, extraction.confidence),
    fields: extraction.fields,
    raw: {
      classifier: {
        content: classify.content,
        usage: classify.usage,
      },
      extractor: {
        content: extract.content,
        usage: extract.usage,
      },
    },
    cost_cents: cumulativeCost,
  };
}

function parseClassifier(raw: string): ClassifierResponse {
  try {
    const parsed = JSON.parse(raw) as { type?: string; confidence?: string };
    const type = parsed.type;
    const confidence = parsed.confidence;
    if (typeof type !== "string" || typeof confidence !== "string") {
      throw new Error("bad shape");
    }
    if (!isDocType(type)) return { type: "other", confidence: "low" };
    if (!isConfidence(confidence)) return { type, confidence: "low" };
    return { type, confidence };
  } catch {
    return { type: "other", confidence: "low" };
  }
}

function parseExtraction(raw: string): ExtractionResponse {
  try {
    const parsed = JSON.parse(raw) as {
      confidence?: string;
      fields?: Record<string, unknown>;
    };
    const confidence = isConfidence(parsed.confidence) ? parsed.confidence : "low";
    const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
    return { confidence, fields };
  } catch {
    return { confidence: "low", fields: {} };
  }
}

function isDocType(v: string): v is ExtractionDocumentType {
  return ["template", "contract", "invoice", "license", "insurance", "other"].includes(v);
}

function isConfidence(v: unknown): v is ExtractionConfidence {
  return v === "high" || v === "medium" || v === "low";
}

const RANK: Record<ExtractionConfidence, number> = { low: 0, medium: 1, high: 2 };
function minConfidence(
  a: ExtractionConfidence,
  b: ExtractionConfidence,
): ExtractionConfidence {
  return RANK[a] <= RANK[b] ? a : b;
}
