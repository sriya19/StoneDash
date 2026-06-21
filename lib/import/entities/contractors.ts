// Contractors CSV import — server-only commit handler. Same shape as
// the customers importer; differences are limited to the field set,
// the Zod schema, and the destination table.

import "server-only";

import { z } from "zod";

import type { AuthContext } from "@/lib/auth";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EntityCommitConfig,
  EntityCommitHandler,
} from "@/lib/import/commit";
import {
  CONTRACTOR_IMPORT_FIELDS,
  type ContractorField,
} from "./contractors.config";

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

const ImportContractorRow = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  primaryContact: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z
    .union([z.string().trim().email("Invalid email").max(200), z.literal(""), z.null()])
    .optional(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  paymentTerms: z.string().trim().max(100).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

type ImportContractorRowT = z.infer<typeof ImportContractorRow>;

function blankToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function makeContractorsCommitConfig(
  auth: AuthContext,
  supabase: SupabaseServerClient,
): EntityCommitConfig<ContractorField> {
  const handler: EntityCommitHandler<ContractorField> = async (chunk, rowOffsets) => {
    let inserted = 0;
    let skipped = 0;
    const warnings: string[] = [];

    type ContractorInsert = {
      org_id: string;
      created_by: string;
      name: string;
      primary_contact: string | null;
      phone: string | null;
      email: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      payment_terms: string | null;
      notes: string | null;
      // is_active defaults to true at the DB level; we leave it off the
      // insert so the column default applies.
    };

    const toInsert: ContractorInsert[] = [];

    chunk.forEach((row, idx) => {
      const rowNumber = rowOffsets[idx] ?? idx + 1;

      const parsed = ImportContractorRow.safeParse(row);
      if (!parsed.success) {
        skipped += 1;
        const first = parsed.error.issues[0];
        warnings.push(
          `Row ${rowNumber}: ${first?.message ?? "validation failed"}`,
        );
        return;
      }

      const v = parsed.data as ImportContractorRowT;
      toInsert.push({
        org_id: auth.org.id,
        created_by: auth.userId,
        name: v.name,
        primary_contact: blankToNull(v.primaryContact ?? undefined),
        phone: blankToNull(v.phone ?? undefined),
        email: blankToNull(v.email ?? undefined),
        address_line1: blankToNull(v.addressLine1 ?? undefined),
        address_line2: blankToNull(v.addressLine2 ?? undefined),
        city: blankToNull(v.city ?? undefined),
        state: blankToNull(v.state ?? undefined),
        postal_code: blankToNull(v.postalCode ?? undefined),
        payment_terms: blankToNull(v.paymentTerms ?? undefined),
        notes: blankToNull(v.notes ?? undefined),
      });
    });

    if (toInsert.length > 0) {
      const { error } = await supabase.from("contractors").insert(toInsert);
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
    allFields: CONTRACTOR_IMPORT_FIELDS.map((f) => f.field) as readonly ContractorField[],
    requiredFields: CONTRACTOR_IMPORT_FIELDS.filter((f) => f.required).map(
      (f) => f.field,
    ) as readonly ContractorField[],
    handler,
  };
}
