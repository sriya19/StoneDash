// Per-doc-type UI field definitions. Bound to the shapes from
// types.ts but shaped for the review form (label, input type,
// grouping). Kept client-safe so the review sheet can consume it
// without a server-only import.

import type { SupportedDocumentType } from "./types";

export type FieldKind = "text" | "textarea" | "number" | "integer" | "money" | "date";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
};

export const FIELD_DEFS: Record<SupportedDocumentType, FieldDef[]> = {
  template: [
    { key: "customer_name", label: "Customer name", kind: "text" },
    { key: "project_address", label: "Project address", kind: "text" },
    { key: "measurement_date", label: "Measurement date", kind: "date" },
    { key: "total_sqft", label: "Total sqft", kind: "number" },
    { key: "sink_cutouts", label: "Sink cutouts", kind: "integer" },
    { key: "cooktop_cutouts", label: "Cooktop cutouts", kind: "integer" },
    { key: "edge_profile", label: "Edge profile", kind: "text" },
    { key: "stone_type", label: "Stone type", kind: "text" },
    { key: "notes", label: "Notes", kind: "textarea" },
  ],
  contract: [
    { key: "customer_name", label: "Customer name", kind: "text" },
    { key: "project_description", label: "Project description", kind: "textarea" },
    { key: "quote_amount", label: "Quote amount", kind: "money" },
    { key: "deposit_amount", label: "Deposit amount", kind: "money" },
    { key: "contract_date", label: "Contract date", kind: "date" },
    { key: "install_date", label: "Install date", kind: "date" },
  ],
  invoice: [
    { key: "vendor_name", label: "Vendor", kind: "text" },
    { key: "invoice_number", label: "Invoice #", kind: "text" },
    { key: "invoice_date", label: "Invoice date", kind: "date" },
    { key: "due_date", label: "Due date", kind: "date" },
    { key: "subtotal", label: "Subtotal", kind: "money" },
    { key: "tax", label: "Tax", kind: "money" },
    { key: "total", label: "Total", kind: "money" },
  ],
  license: [
    { key: "holder_name", label: "Holder", kind: "text" },
    { key: "license_number", label: "License #", kind: "text" },
    { key: "issuing_authority", label: "Issuing authority", kind: "text" },
    { key: "issue_date", label: "Issue date", kind: "date" },
    { key: "expiry_date", label: "Expiry date", kind: "date" },
  ],
  insurance: [
    { key: "insured_name", label: "Insured", kind: "text" },
    { key: "carrier", label: "Carrier", kind: "text" },
    { key: "policy_number", label: "Policy #", kind: "text" },
    { key: "coverage_type", label: "Coverage type", kind: "text" },
    { key: "effective_date", label: "Effective date", kind: "date" },
    { key: "expiry_date", label: "Expiry date", kind: "date" },
  ],
};

// Map a raw stored value to a form-friendly string for the input.
export function toInputValue(raw: unknown, kind: FieldKind): string {
  if (raw == null) return "";
  if (kind === "money" || kind === "number" || kind === "integer") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? String(n) : "";
  }
  return String(raw);
}

// Map a form input string back to a storage value (null when blank).
export function fromInputValue(raw: string, kind: FieldKind): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (kind === "money" || kind === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "integer") {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  return trimmed;
}
