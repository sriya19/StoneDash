// Orders CSV import — server-only commit handler. More involved than
// customers/contractors because each row resolves two foreign keys
// (customer required, contractor optional) and one flexible date, and
// each order needs an order_number generated via the existing
// generate_order_number RPC.

import "server-only";

import { z } from "zod";

import type { AuthContext } from "@/lib/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseFlexibleDate } from "@/lib/import/helpers";
import type {
  EntityCommitConfig,
  EntityCommitHandler,
} from "@/lib/import/commit";
import { ORDER_STAGES } from "@/lib/validators/orders";
import {
  ORDER_IMPORT_FIELDS,
  type OrderField,
} from "./orders.config";

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

// ---------------------------------------------------------------------------
// Row validator
// ---------------------------------------------------------------------------
//
// Stage is validated against the existing ORDER_STAGES enum; empty
// string → undefined → defaults to "quote" on insert. Quote / deposit
// numbers are parsed as money (accept "1234.56", "$1,234.56", or
// "1,234.56"). Install date stays a raw string here; we transform it
// in the handler via parseFlexibleDate after Zod passes so the error
// message can name the offending value.

const moneyImport = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null || v === "") return undefined;
    const s = typeof v === "number" ? String(v) : v;
    const cleaned = s.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), {
    message: "Enter a non-negative number",
  });

const stageImport = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null) return undefined;
    const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return t === "" ? undefined : t;
  })
  .refine(
    (v) => v === undefined || (ORDER_STAGES as readonly string[]).includes(v),
    { message: `Stage must be one of: ${ORDER_STAGES.join(", ")}` },
  );

const ImportOrderRow = z.object({
  customerName: z.string().trim().min(1, "Customer name is required").max(200),
  projectName: z.string().trim().min(1, "Project name is required").max(200),
  contractorName: z.string().trim().max(200).optional().nullable(),
  stoneType: z.string().trim().max(200).optional().nullable(),
  edgeProfile: z.string().trim().max(200).optional().nullable(),
  quoteAmount: moneyImport.optional(),
  depositReceived: moneyImport.optional(),
  stage: stageImport.optional(),
  // Raw date string. Parsed below via parseFlexibleDate so a bad
  // date produces a row-scoped warning naming the original input
  // instead of a generic Zod regex error.
  scheduledInstallDate: z.string().trim().max(40).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

type ImportOrderRowT = z.infer<typeof ImportOrderRow>;

function blankToNull(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// Normalize a name for case-insensitive lookup. We match "John Smith",
// "john smith", and "JOHN  SMITH" to the same customer; whitespace
// collapse handles double-spaces in messy spreadsheet data.
function nameKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function makeOrdersCommitConfig(
  auth: AuthContext,
  supabase: SupabaseServerClient,
): EntityCommitConfig<OrderField> {
  // Pre-fetch the org's customers + contractors ONCE for the whole
  // import (cached across chunks via the closure). Lookups become
  // O(1) hash hits instead of per-row roundtrips. Two cheap queries
  // up-front beats 5000-row imports doing 10,000 lookup queries.
  let customersByName: Map<string, string> | null = null;
  let contractorsByName: Map<string, string> | null = null;

  async function loadLookups(): Promise<void> {
    if (customersByName && contractorsByName) return;
    const [cust, contr] = await Promise.all([
      supabase
        .from("customers")
        .select("id, name")
        .returns<{ id: string; name: string }[]>(),
      supabase
        .from("contractors")
        .select("id, name")
        .eq("is_active", true)
        .returns<{ id: string; name: string }[]>(),
    ]);
    customersByName = new Map(
      (cust.data ?? []).map((c) => [nameKey(c.name), c.id]),
    );
    contractorsByName = new Map(
      (contr.data ?? []).map((c) => [nameKey(c.name), c.id]),
    );
  }

  type OrderInsert = {
    org_id: string;
    order_number: string;
    customer_id: string;
    contractor_id: string | null;
    project_name: string;
    stage: string;
    stone_type: string | null;
    edge_profile: string | null;
    quote_amount: number | null;
    deposit_received: number;
    notes: string | null;
    scheduled_install_date: string | null;
    created_by: string;
  };

  const handler: EntityCommitHandler<OrderField> = async (chunk, rowOffsets) => {
    await loadLookups();

    let inserted = 0;
    let skipped = 0;
    const warnings: string[] = [];

    const toInsert: OrderInsert[] = [];

    for (let idx = 0; idx < chunk.length; idx += 1) {
      const row = chunk[idx]!;
      const rowNumber = rowOffsets[idx] ?? idx + 1;

      const parsed = ImportOrderRow.safeParse(row);
      if (!parsed.success) {
        skipped += 1;
        const first = parsed.error.issues[0];
        warnings.push(
          `Row ${rowNumber}: ${first?.message ?? "validation failed"}`,
        );
        continue;
      }
      const v = parsed.data as ImportOrderRowT;

      // Resolve customer (required). Skip the row with a warning if
      // the name doesn't match anything in the org.
      const customerId = customersByName!.get(nameKey(v.customerName));
      if (!customerId) {
        skipped += 1;
        warnings.push(
          `Row ${rowNumber}: customer "${v.customerName}" not found — import customers first or fix the name.`,
        );
        continue;
      }

      // Resolve contractor (optional). Mismatch warns but lets the
      // row through with contractor_id null.
      let contractorId: string | null = null;
      if (v.contractorName) {
        const found = contractorsByName!.get(nameKey(v.contractorName));
        if (found) {
          contractorId = found;
        } else {
          warnings.push(
            `Row ${rowNumber}: contractor "${v.contractorName}" not found — order imported without contractor.`,
          );
        }
      }

      // Parse install date (optional). Bad date warns but doesn't
      // skip — better to land the order with no date than lose it
      // entirely because of a typo.
      let scheduledInstallDate: string | null = null;
      if (v.scheduledInstallDate && v.scheduledInstallDate.trim() !== "") {
        const iso = parseFlexibleDate(v.scheduledInstallDate);
        if (iso) {
          scheduledInstallDate = iso;
        } else {
          warnings.push(
            `Row ${rowNumber}: couldn't parse install date "${v.scheduledInstallDate}" — order imported without date.`,
          );
        }
      }

      // Generate order_number via the RLS-safe RPC. Same call the
      // manual New Order flow uses, so imported orders get numbers
      // from the same per-org sequence (no gap, no collision).
      const { data: rpcValue, error: rpcError } = await supabase.rpc(
        "generate_order_number",
        { p_org_id: auth.org.id },
      );
      if (rpcError || typeof rpcValue !== "string") {
        skipped += 1;
        warnings.push(
          `Row ${rowNumber}: couldn't assign order number — ${rpcError?.message ?? "unknown"}`,
        );
        continue;
      }

      toInsert.push({
        org_id: auth.org.id,
        order_number: rpcValue,
        customer_id: customerId,
        contractor_id: contractorId,
        project_name: v.projectName,
        stage: v.stage ?? "quote",
        stone_type: blankToNull(v.stoneType ?? undefined),
        edge_profile: blankToNull(v.edgeProfile ?? undefined),
        quote_amount: v.quoteAmount ?? null,
        deposit_received: v.depositReceived ?? 0,
        notes: blankToNull(v.notes ?? undefined),
        scheduled_install_date: scheduledInstallDate,
        created_by: auth.userId,
      });
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("orders").insert(toInsert);
      if (error) {
        skipped += toInsert.length;
        warnings.push(
          `Rows ${rowOffsets[0]}-${rowOffsets[rowOffsets.length - 1]}: ${error.message}`,
        );
      } else {
        inserted += toInsert.length;
      }
    }

    return { inserted, skipped, warnings };
  };

  return {
    allFields: ORDER_IMPORT_FIELDS.map((f) => f.field) as readonly OrderField[],
    requiredFields: ORDER_IMPORT_FIELDS.filter((f) => f.required).map(
      (f) => f.field,
    ) as readonly OrderField[],
    handler,
  };
}
