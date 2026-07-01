// System + user prompts for the two-step extraction pipeline.
//
// PLAN Q9 lock: gpt-4o-mini classifies (~15× cheaper); gpt-4o
// extracts on supported types. Both calls send the file contents
// but NEVER any StoneDash-internal identifiers (org_id, user_id,
// order metadata, filename). Data-minimization boundary at Q3.
//
// Extraction responses are constrained to a per-document-type JSON
// schema via response_format: json_schema so the model doesn't
// return prose or an invented field.

import type { SupportedDocumentType } from "./types";

// Classifier system prompt — kept short. The model just picks one of
// six categories; long context wastes tokens.
export const CLASSIFIER_SYSTEM = `You are a document classifier for a stone / marble / granite fabrication shop's operations software.

You will be shown a document (image or PDF). Classify it into exactly ONE of:
- "template" — measurement sheet, templating notes, sketch of a countertop layout with dimensions
- "contract" — signed contract, quote proposal, work order the shop sends to a customer
- "invoice" — invoice received by the shop from a supplier (slab yard, sundries vendor, etc.)
- "license" — business license, contractor license, installer certification
- "insurance" — certificate of insurance (COI), liability insurance certificate
- "other" — anything else (a random photo, a receipt from an unrelated vendor, a plain text note, etc.)

Return JSON matching this schema exactly:
{ "type": "template" | "contract" | "invoice" | "license" | "insurance" | "other", "confidence": "high" | "medium" | "low" }

Be conservative: if you're not sure, return "other" with "low" confidence rather than guessing.`;

export const CLASSIFIER_USER =
  "Classify this document.";

// ---------------------------------------------------------------------------
// Per-type extraction system prompts + JSON schemas
// ---------------------------------------------------------------------------

const EXTRACTION_BASE = `You are extracting structured data from a document for a stone fabrication shop's operations software.

Rules:
- Return ONLY the JSON matching the schema. No prose, no markdown fences, no explanation.
- Use null for fields you cannot find with high confidence. Do not guess.
- Dates must be formatted as "yyyy-MM-dd". Convert other formats (MM/DD/YYYY, "Jun 15, 2026", etc.) before returning.
- Numeric fields must be plain numbers (no currency symbols, no commas).
- If the document is a scan and text is unclear, prefer null over a partial guess.
- Set "confidence" to "high" only if you can read the whole document clearly. Otherwise "medium" or "low".`;

export const EXTRACTION_SYSTEM: Record<SupportedDocumentType, string> = {
  template: `${EXTRACTION_BASE}

You are extracting from a MEASUREMENT SHEET / TEMPLATE. Fields:
  customer_name, project_address, measurement_date, total_sqft,
  sink_cutouts (integer count), cooktop_cutouts (integer count),
  edge_profile (e.g. "Eased", "Ogee", "Mitered"), stone_type,
  notes.`,
  contract: `${EXTRACTION_BASE}

You are extracting from a CONTRACT / QUOTE. Fields:
  customer_name, project_description, quote_amount, deposit_amount,
  contract_date, install_date.`,
  invoice: `${EXTRACTION_BASE}

You are extracting from an INVOICE the shop received from a supplier
(slab yard, sundries, etc.). Fields:
  vendor_name, invoice_number, invoice_date, due_date,
  subtotal, tax, total,
  line_items — an array of { description, quantity, unit_price }.`,
  license: `${EXTRACTION_BASE}

You are extracting from a LICENSE / CERTIFICATE (business, contractor,
installer). Fields:
  holder_name, license_number, issuing_authority,
  issue_date, expiry_date.`,
  insurance: `${EXTRACTION_BASE}

You are extracting from a CERTIFICATE OF INSURANCE. Fields:
  insured_name, carrier, policy_number, coverage_type,
  effective_date, expiry_date.`,
};

// JSON schemas passed via response_format so the model output is
// well-formed per type. Each schema wraps the fields in a top-level
// object with a required "fields" key plus a "confidence" tier.
// `additionalProperties: false` keeps the model from inventing keys.

type JsonSchema = Record<string, unknown>;

const strDate = { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const strAny = { type: ["string", "null"] };
const numAny = { type: ["number", "null"] };
const intAny = { type: ["integer", "null"] };

function wrap(fieldsSchema: JsonSchema, name: string): JsonSchema {
  return {
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["confidence", "fields"],
      properties: {
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        fields: fieldsSchema,
      },
    },
  };
}

export const EXTRACTION_SCHEMA: Record<SupportedDocumentType, JsonSchema> = {
  template: wrap(
    {
      type: "object",
      additionalProperties: false,
      required: [
        "customer_name",
        "project_address",
        "measurement_date",
        "total_sqft",
        "sink_cutouts",
        "cooktop_cutouts",
        "edge_profile",
        "stone_type",
        "notes",
      ],
      properties: {
        customer_name: strAny,
        project_address: strAny,
        measurement_date: strDate,
        total_sqft: numAny,
        sink_cutouts: intAny,
        cooktop_cutouts: intAny,
        edge_profile: strAny,
        stone_type: strAny,
        notes: strAny,
      },
    },
    "template_extraction",
  ),
  contract: wrap(
    {
      type: "object",
      additionalProperties: false,
      required: [
        "customer_name",
        "project_description",
        "quote_amount",
        "deposit_amount",
        "contract_date",
        "install_date",
      ],
      properties: {
        customer_name: strAny,
        project_description: strAny,
        quote_amount: numAny,
        deposit_amount: numAny,
        contract_date: strDate,
        install_date: strDate,
      },
    },
    "contract_extraction",
  ),
  invoice: wrap(
    {
      type: "object",
      additionalProperties: false,
      required: [
        "vendor_name",
        "invoice_number",
        "invoice_date",
        "due_date",
        "subtotal",
        "tax",
        "total",
        "line_items",
      ],
      properties: {
        vendor_name: strAny,
        invoice_number: strAny,
        invoice_date: strDate,
        due_date: strDate,
        subtotal: numAny,
        tax: numAny,
        total: numAny,
        line_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["description", "quantity", "unit_price"],
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
            },
          },
        },
      },
    },
    "invoice_extraction",
  ),
  license: wrap(
    {
      type: "object",
      additionalProperties: false,
      required: [
        "holder_name",
        "license_number",
        "issuing_authority",
        "issue_date",
        "expiry_date",
      ],
      properties: {
        holder_name: strAny,
        license_number: strAny,
        issuing_authority: strAny,
        issue_date: strDate,
        expiry_date: strDate,
      },
    },
    "license_extraction",
  ),
  insurance: wrap(
    {
      type: "object",
      additionalProperties: false,
      required: [
        "insured_name",
        "carrier",
        "policy_number",
        "coverage_type",
        "effective_date",
        "expiry_date",
      ],
      properties: {
        insured_name: strAny,
        carrier: strAny,
        policy_number: strAny,
        coverage_type: strAny,
        effective_date: strDate,
        expiry_date: strDate,
      },
    },
    "insurance_extraction",
  ),
};
