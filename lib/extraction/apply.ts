import "server-only";

import type { AuthContext } from "@/lib/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FileExtractionDetail } from "@/lib/queries/extractions";
import {
  computeProposedActions,
  type ProposedAction,
} from "./proposed-actions";

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

// Rendered into applied_actions JSONB on the extraction row.
export type AppliedAction =
  | {
      type: "update_order_field";
      field: string;
      old: unknown;
      new: unknown;
    }
  | {
      type: "create_reminder";
      reminder_id: string;
      remind_at: string;
      kind: "license_expiry" | "insurance_expiry" | "invoice_due";
    };

export async function applyExtractionActions(args: {
  auth: AuthContext;
  supabase: SupabaseServerClient;
  extraction: FileExtractionDetail;
  // Field edits the user made in the review sheet (may differ from
  // extracted_fields the model returned). Used to recompute the
  // proposed actions so a user-corrected value flows through.
  overrideFields: Record<string, unknown> | null;
  // Keys of proposed actions the user checked in the review sheet.
  selectedKeys: string[];
  fileLinkUrl: string;
}): Promise<AppliedAction[]> {
  const { auth, supabase, extraction, overrideFields, selectedKeys, fileLinkUrl } = args;

  // Recompute proposed actions from the (possibly edited) fields.
  // The keys are stable — {update:<field>} or {remind:<slot>} — so
  // the selected set intersects cleanly.
  const proposed: ProposedAction[] = computeProposedActions({
    extraction,
    overrideFields,
    reviewerUserId: auth.userId,
    fileLinkUrl,
  });
  const selected = new Set(selectedKeys);
  const toApply = proposed.filter((p) => selected.has(p.key));

  const applied: AppliedAction[] = [];

  // Group order-field updates so we do at most one UPDATE per order.
  const orderPatch: Record<string, unknown> = {};
  const orderUpdatesForAudit: Array<{
    field: string;
    old: unknown;
    new: unknown;
  }> = [];

  for (const action of toApply) {
    if (action.type === "update_order_field") {
      orderPatch[action.field] = action.proposedValue;
      orderUpdatesForAudit.push({
        field: action.field,
        old: action.currentValue,
        new: action.proposedValue,
      });
    }
  }

  if (extraction.order && Object.keys(orderPatch).length > 0) {
    const { error } = await supabase
      .from("orders")
      .update({ ...orderPatch, updated_at: new Date().toISOString() })
      .eq("id", extraction.order.id);
    if (error) {
      throw new Error(`Order update failed: ${error.message}`);
    }
    for (const u of orderUpdatesForAudit) {
      applied.push({
        type: "update_order_field",
        field: u.field,
        old: u.old,
        new: u.new,
      });
    }
  }

  // Reminder creates — insert one row per selected reminder. RLS
  // requires manager+ (already checked in confirmExtraction).
  for (const action of toApply) {
    if (action.type !== "create_reminder") continue;
    const { data, error } = await supabase
      .from("reminders")
      .insert({
        org_id: auth.org.id,
        user_id: auth.userId, // reviewer gets the reminder by default
        title: action.title,
        body: action.body,
        remind_at: action.remindAt,
        kind: action.kind,
        source_type: "file_extraction",
        source_id: extraction.id,
        link_url: fileLinkUrl,
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !data) {
      // Non-fatal: log + skip. The confirm still succeeds with
      // whatever else applied.
      process.stderr.write(
        `[extractions] reminder insert failed: ${error?.message ?? "unknown"}\n`,
      );
      continue;
    }
    applied.push({
      type: "create_reminder",
      reminder_id: data.id,
      remind_at: action.remindAt,
      kind: action.kind,
    });
  }

  return applied;
}
