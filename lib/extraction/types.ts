// Shared types for the AI document extraction pipeline. Kept in a
// leaf module (no server-only, no client-only) so the shared
// dialog + server-side route can import the same shapes.

import type {
  ExtractionConfidence,
  ExtractionDocumentType,
} from "@/lib/supabase/types";

export type ExtractionResult = {
  document_type: ExtractionDocumentType;
  confidence: ExtractionConfidence | null;
  fields: Record<string, unknown>;
  // Raw model response payload retained for debugging + audit. Never
  // shown to the user directly.
  raw: Record<string, unknown>;
  cost_cents: number;
};

// ---------------------------------------------------------------------------
// Per-document-type field shapes.
//
// These describe the EXPECTED structure of `fields` for each
// document_type. The route + confirm action + review sheet all
// consume these — the source of truth for "what the extraction
// looks like when it comes back."
// ---------------------------------------------------------------------------

export type TemplateFields = {
  customer_name?: string | null;
  project_address?: string | null;
  measurement_date?: string | null; // yyyy-MM-dd
  total_sqft?: number | null;
  sink_cutouts?: number | null;
  cooktop_cutouts?: number | null;
  edge_profile?: string | null;
  stone_type?: string | null;
  notes?: string | null;
};

export type ContractFields = {
  customer_name?: string | null;
  project_description?: string | null;
  quote_amount?: number | null;
  deposit_amount?: number | null;
  contract_date?: string | null; // yyyy-MM-dd
  install_date?: string | null; // yyyy-MM-dd
};

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unit_price: number;
};

export type InvoiceFields = {
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null; // yyyy-MM-dd
  due_date?: string | null; // yyyy-MM-dd
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  line_items?: InvoiceLineItem[];
};

export type LicenseFields = {
  holder_name?: string | null;
  license_number?: string | null;
  issuing_authority?: string | null;
  issue_date?: string | null; // yyyy-MM-dd
  expiry_date?: string | null; // yyyy-MM-dd
};

export type InsuranceFields = {
  insured_name?: string | null;
  carrier?: string | null;
  policy_number?: string | null;
  coverage_type?: string | null;
  effective_date?: string | null; // yyyy-MM-dd
  expiry_date?: string | null; // yyyy-MM-dd
};

// `other` produces no fields but still resolves to an ExtractionResult
// (with fields={}) so the same code path always applies.
export type OtherFields = Record<string, never>;

export const SUPPORTED_DOCUMENT_TYPES = [
  "template",
  "contract",
  "invoice",
  "license",
  "insurance",
] as const;

export type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];

export function isSupportedType(
  type: ExtractionDocumentType,
): type is SupportedDocumentType {
  return (SUPPORTED_DOCUMENT_TYPES as readonly string[]).includes(type);
}
