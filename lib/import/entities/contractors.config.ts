// Client-safe contractors import config. Split out from the
// server-only `contractors.ts` so the field list can ship to the
// client bundle without dragging Supabase imports along.

import type {
  CsvImportConfig,
  ImportFieldConfig,
} from "@/components/app/csv-import-sheet";

export type ContractorField =
  | "name"
  | "primaryContact"
  | "phone"
  | "email"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "paymentTerms"
  | "notes";

export const CONTRACTOR_IMPORT_FIELDS: ImportFieldConfig<ContractorField>[] = [
  {
    field: "name",
    label: "Name",
    required: true,
    aliases: [
      "name",
      "contractor",
      "contractor_name",
      "company",
      "company_name",
      "business",
      "business_name",
    ],
  },
  {
    field: "primaryContact",
    label: "Primary contact",
    aliases: ["primary_contact", "contact", "contact_name", "contact_person", "rep"],
  },
  {
    field: "phone",
    label: "Phone",
    aliases: ["phone", "phone_number", "telephone", "mobile", "cell"],
  },
  {
    field: "email",
    label: "Email",
    aliases: ["email", "email_address", "e_mail"],
  },
  {
    field: "addressLine1",
    label: "Address line 1",
    aliases: ["address", "address_line_1", "address_1", "street", "street_address"],
  },
  {
    field: "addressLine2",
    label: "Address line 2",
    aliases: ["address_line_2", "address_2", "apt", "suite", "unit"],
  },
  { field: "city", label: "City", aliases: ["city", "town"] },
  { field: "state", label: "State", aliases: ["state", "region", "province"] },
  {
    field: "postalCode",
    label: "Postal code",
    aliases: ["postal_code", "zip", "zip_code", "zipcode", "postcode"],
  },
  {
    field: "paymentTerms",
    label: "Payment terms",
    aliases: ["payment_terms", "terms", "net_terms"],
  },
  {
    field: "notes",
    label: "Notes",
    aliases: ["notes", "note", "comments", "remarks"],
  },
];

// `isActive` deliberately is NOT in the import field set. Imported
// contractors default to active; if an owner wants to deactivate them
// later, they do it in the contractor detail UI. Surfacing it as a
// mapping option would force every importer to decide on a column for
// it, and 99% of inputs won't have one.

export const CONTRACTOR_IMPORT_CONFIG: CsvImportConfig<ContractorField> = {
  entity: { singular: "contractor", plural: "contractors" },
  description:
    "Bring contractors, dealers, and builders in from a spreadsheet. We'll match columns automatically — fix any that look wrong before importing.",
  fields: CONTRACTOR_IMPORT_FIELDS,
  commitEndpoint: "/api/import/contractors",
};
