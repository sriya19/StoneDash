// Customers CSV import — server-only commit handler. The field
// config lives in `customers.config.ts` so the client dialog can
// import the same source of truth without dragging server-only
// modules into the bundle.

import "server-only";

import { z } from "zod";

import type { AuthContext } from "@/lib/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EntityCommitConfig,
  EntityCommitHandler,
} from "@/lib/import/commit";
import {
  CUSTOMER_IMPORT_FIELDS,
  type CustomerField,
} from "./customers.config";

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

// Mirror the existing `CustomerFields` validator from lib/validators
// but expressed against the import-row shape (canonical-field keys,
// pre-sanitized values, all strings). Required field surfaces a clean
// row-level warning rather than relying on a NULL constraint blow-up.
const ImportCustomerRow = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  company: z.string().trim().max(200).optional().nullable(),
  email: z
    .union([z.string().trim().email("Invalid email").max(200), z.literal(""), z.null()])
    .optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

type ImportCustomerRowT = z.infer<typeof ImportCustomerRow>;

function blankToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function makeCustomersCommitConfig(
  auth: AuthContext,
  supabase: SupabaseServerClient,
): EntityCommitConfig<CustomerField> {
  const handler: EntityCommitHandler<CustomerField> = async (chunk, rowOffsets) => {
    let inserted = 0;
    let skipped = 0;
    const warnings: string[] = [];

    type CustomerInsert = {
      org_id: string;
      created_by: string;
      name: string;
      company: string | null;
      email: string | null;
      phone: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      notes: string | null;
    };

    const toInsert: CustomerInsert[] = [];

    chunk.forEach((row, idx) => {
      const rowNumber = rowOffsets[idx] ?? idx + 1;

      // Pass the row through with values intact (including empty strings)
      // so the Zod schema can apply its trim/min/optional semantics. Earlier
      // I dropped empty strings here, which turned a "Name is required"
      // failure into a less-friendly "expected string, received undefined."
      const parsed = ImportCustomerRow.safeParse(row);
      if (!parsed.success) {
        skipped += 1;
        const first = parsed.error.issues[0];
        warnings.push(
          `Row ${rowNumber}: ${first?.message ?? "validation failed"}`,
        );
        return;
      }

      const v = parsed.data as ImportCustomerRowT;
      toInsert.push({
        org_id: auth.org.id,
        created_by: auth.userId,
        name: v.name,
        company: blankToNull(v.company ?? undefined),
        email: blankToNull(v.email ?? undefined),
        phone: blankToNull(v.phone ?? undefined),
        address_line1: blankToNull(v.addressLine1 ?? undefined),
        address_line2: blankToNull(v.addressLine2 ?? undefined),
        city: blankToNull(v.city ?? undefined),
        state: blankToNull(v.state ?? undefined),
        postal_code: blankToNull(v.postalCode ?? undefined),
        notes: blankToNull(v.notes ?? undefined),
      });
    });

    if (toInsert.length > 0) {
      const { error } = await supabase.from("customers").insert(toInsert);
      if (error) {
        // Whole-chunk failure (constraint violation, RLS denial, etc.).
        // Mark everything in this chunk as skipped + emit one chunk-
        // scoped warning so the user sees something actionable rather
        // than just "0 inserted".
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
    allFields: CUSTOMER_IMPORT_FIELDS.map((f) => f.field) as readonly CustomerField[],
    requiredFields: CUSTOMER_IMPORT_FIELDS.filter((f) => f.required).map(
      (f) => f.field,
    ) as readonly CustomerField[],
    handler,
  };
}
