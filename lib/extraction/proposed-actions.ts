// Pure "given an extraction + parent order, what would confirming
// do?" calculator. Consumed by:
//   * <ExtractionReviewSheet> to render the proposed-actions
//     checkboxes with meaningful before/after copy.
//   * lib/extraction/apply.ts (sub-step 7) to actually run each
//     selected action inside confirmExtraction.
//
// Kept free of "use server" and DB access so both surfaces can
// share the same source of truth for what an extraction *means*.

import { addDays, subDays } from "date-fns";

import type { ExtractionDocumentType } from "@/lib/supabase/types";
import type { FileExtractionDetail } from "@/lib/queries/extractions";

export type OrderFieldKey =
  | "project_name"
  | "stone_type"
  | "edge_profile"
  | "sink_cutouts"
  | "cooktop_cutouts"
  | "quote_amount"
  | "deposit_received"
  | "scheduled_install_date"
  | "notes";

export type ProposedAction =
  | {
      key: string;
      type: "update_order_field";
      field: OrderFieldKey;
      currentValue: string | number | null;
      proposedValue: string | number;
      // Fields already populated on the order default unchecked (Q10
      // lock — never silently overwrite a manual edit).
      defaultChecked: boolean;
      description: string;
    }
  | {
      key: string;
      type: "create_reminder";
      remindAt: string; // ISO
      title: string;
      body: string | null;
      kind: "license_expiry" | "insurance_expiry" | "invoice_due";
      defaultChecked: boolean;
      description: string;
    };

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function orderFieldCurrent(
  order: NonNullable<FileExtractionDetail["order"]>,
  field: OrderFieldKey,
): string | number | null {
  switch (field) {
    case "project_name":
      return order.project_name;
    case "stone_type":
      return order.stone_type;
    case "edge_profile":
      return order.edge_profile;
    case "sink_cutouts":
      return order.sink_cutouts;
    case "cooktop_cutouts":
      return order.cooktop_cutouts;
    case "quote_amount":
      return toNum(order.quote_amount);
    case "deposit_received":
      return toNum(order.deposit_received);
    case "scheduled_install_date":
      return order.scheduled_install_date;
    case "notes":
      return order.notes;
  }
}

function isEmpty(v: string | number | null): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return v === 0;
  return false;
}

// Template extractions offer to fill any of nine order fields.
// project_address is intentionally NOT mapped to any single order
// column — the shop's order has customer address, not project
// address; if we start storing project addresses on orders later,
// map it.
const TEMPLATE_FIELD_MAP: Record<string, OrderFieldKey> = {
  stone_type: "stone_type",
  edge_profile: "edge_profile",
  sink_cutouts: "sink_cutouts",
  cooktop_cutouts: "cooktop_cutouts",
  notes: "notes",
};

const CONTRACT_FIELD_MAP: Record<string, OrderFieldKey> = {
  quote_amount: "quote_amount",
  deposit_amount: "deposit_received",
  project_description: "project_name",
  install_date: "scheduled_install_date",
};

function labelFor(field: OrderFieldKey): string {
  const LABELS: Record<OrderFieldKey, string> = {
    project_name: "project name",
    stone_type: "stone type",
    edge_profile: "edge profile",
    sink_cutouts: "sink cutouts",
    cooktop_cutouts: "cooktop cutouts",
    quote_amount: "quote amount",
    deposit_received: "deposit received",
    scheduled_install_date: "install date",
    notes: "notes",
  };
  return LABELS[field];
}

function formatValue(field: OrderFieldKey, v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (field === "quote_amount" || field === "deposit_received") {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return fmtMoney(n);
  }
  return String(v);
}

export type ProposedActionsInput = {
  extraction: FileExtractionDetail;
  // The fields the review sheet is currently showing (user may have
  // edited from the raw extraction). Defaults to the stored
  // extracted_fields when omitted.
  overrideFields?: Record<string, unknown> | null;
  // reviewer id — used only to attach a reminder recipient. Passed
  // in so we don't need to reach into auth from a pure helper.
  reviewerUserId: string;
  // Encoded at write time so reminder link_url can jump back to the
  // source file. Pass in the routing prefix that matches the app's
  // Files-tab deep-link pattern.
  fileLinkUrl: string;
};

export function computeProposedActions(
  input: ProposedActionsInput,
): ProposedAction[] {
  const { extraction, reviewerUserId, fileLinkUrl } = input;
  const fields = (input.overrideFields ?? extraction.extracted_fields ?? {}) as Record<
    string,
    unknown
  >;
  const type: ExtractionDocumentType = extraction.document_type;

  const actions: ProposedAction[] = [];

  if (type === "template" && extraction.order) {
    for (const [srcKey, dstKey] of Object.entries(TEMPLATE_FIELD_MAP)) {
      const raw = fields[srcKey];
      const proposed = normalizeForField(raw, dstKey);
      if (proposed === null) continue;
      const current = orderFieldCurrent(extraction.order, dstKey);
      // No-op if same
      if (current !== null && current !== undefined && String(current) === String(proposed)) continue;
      actions.push({
        key: `update:${dstKey}`,
        type: "update_order_field",
        field: dstKey,
        currentValue: current,
        proposedValue: proposed,
        defaultChecked: isEmpty(current),
        description: `Set ${labelFor(dstKey)} to ${formatValue(dstKey, proposed)} (was ${formatValue(dstKey, current)})`,
      });
    }
  }

  if (type === "contract" && extraction.order) {
    for (const [srcKey, dstKey] of Object.entries(CONTRACT_FIELD_MAP)) {
      const raw = fields[srcKey];
      const proposed = normalizeForField(raw, dstKey);
      if (proposed === null) continue;
      const current = orderFieldCurrent(extraction.order, dstKey);
      if (current !== null && current !== undefined && String(current) === String(proposed)) continue;
      actions.push({
        key: `update:${dstKey}`,
        type: "update_order_field",
        field: dstKey,
        currentValue: current,
        proposedValue: proposed,
        defaultChecked: isEmpty(current),
        description: `Set ${labelFor(dstKey)} to ${formatValue(dstKey, proposed)} (was ${formatValue(dstKey, current)})`,
      });
    }
  }

  if (type === "license") {
    const expiry = toStr(fields.expiry_date);
    const holder = toStr(fields.holder_name) ?? "License";
    if (expiry && isFutureIsoDate(expiry)) {
      const expiryDate = new Date(`${expiry}T09:00:00Z`);
      actions.push({
        key: "remind:license_30d",
        type: "create_reminder",
        remindAt: subDays(expiryDate, 30).toISOString(),
        title: `${holder} license expires in 30 days`,
        body: `License expiry: ${expiry}`,
        kind: "license_expiry",
        defaultChecked: true,
        description: `Remind ${dateHuman(subDays(expiryDate, 30))} — 30 days before expiry`,
      });
      actions.push({
        key: "remind:license_7d",
        type: "create_reminder",
        remindAt: subDays(expiryDate, 7).toISOString(),
        title: `${holder} license expires in 7 days`,
        body: `License expiry: ${expiry}`,
        kind: "license_expiry",
        defaultChecked: true,
        description: `Remind ${dateHuman(subDays(expiryDate, 7))} — 7 days before expiry`,
      });
    }
  }

  if (type === "insurance") {
    const expiry = toStr(fields.expiry_date);
    const insured = toStr(fields.insured_name) ?? "Insurance";
    if (expiry && isFutureIsoDate(expiry)) {
      const expiryDate = new Date(`${expiry}T09:00:00Z`);
      actions.push({
        key: "remind:insurance_30d",
        type: "create_reminder",
        remindAt: subDays(expiryDate, 30).toISOString(),
        title: `${insured} insurance expires in 30 days`,
        body: `Policy expiry: ${expiry}`,
        kind: "insurance_expiry",
        defaultChecked: true,
        description: `Remind ${dateHuman(subDays(expiryDate, 30))} — 30 days before expiry`,
      });
    }
  }

  if (type === "invoice") {
    const due = toStr(fields.due_date);
    const vendor = toStr(fields.vendor_name) ?? "Invoice";
    if (due && isFutureIsoDate(due)) {
      const dueDate = new Date(`${due}T09:00:00Z`);
      actions.push({
        key: "remind:invoice_due",
        type: "create_reminder",
        remindAt: subDays(dueDate, 3).toISOString(),
        title: `${vendor} invoice due in 3 days`,
        body: `Due date: ${due}`,
        kind: "invoice_due",
        defaultChecked: true,
        description: `Remind ${dateHuman(subDays(dueDate, 3))} — 3 days before due`,
      });
    }
  }

  return actions;

  // Reviewer + file link are on the closure so create_reminder in
  // apply.ts has them without re-computing.
  // (Silence unused-var by referencing here in a no-op way.)
  void reviewerUserId;
  void fileLinkUrl;
}

function normalizeForField(
  raw: unknown,
  field: OrderFieldKey,
): string | number | null {
  if (raw == null || raw === "") return null;
  if (
    field === "sink_cutouts" ||
    field === "cooktop_cutouts"
  ) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.trunc(n);
  }
  if (field === "quote_amount" || field === "deposit_received") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  if (field === "scheduled_install_date") {
    const s = String(raw).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return String(raw).trim();
}

function isFutureIsoDate(iso: string): boolean {
  const d = new Date(`${iso}T09:00:00Z`);
  return d.getTime() > Date.now();
}

function dateHuman(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Re-export so consumers can compute a "sensible remind_at horizon"
// without duplicating the constant.
export const REMINDER_DEFAULT_HOUR = 9;
export { addDays, subDays };
