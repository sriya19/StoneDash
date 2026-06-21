// Client-safe customers import config — shared between the client
// dialog (`<CsvImportSheet>`) and the server commit handler (sibling
// `customers.ts`, server-only). Splitting the field list out of the
// server module lets the client import the same source-of-truth
// without dragging Supabase / server-only imports into the bundle.

import type {
  CsvImportConfig,
  ImportFieldConfig,
} from "@/components/app/csv-import-sheet";

export type CustomerField =
  | "name"
  | "company"
  | "email"
  | "phone"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "notes";

// Aliases are already in `normalizeHeader` shape (lowercase,
// underscore-collapsed) so the auto-mapper can match without
// re-normalizing per-field.
export const CUSTOMER_IMPORT_FIELDS: ImportFieldConfig<CustomerField>[] = [
  {
    field: "name",
    label: "Name",
    required: true,
    aliases: ["name", "customer", "customer_name", "full_name", "contact", "contact_name"],
  },
  {
    field: "company",
    label: "Company",
    aliases: ["company", "company_name", "business", "business_name", "organization"],
  },
  {
    field: "email",
    label: "Email",
    aliases: ["email", "email_address", "e_mail"],
  },
  {
    field: "phone",
    label: "Phone",
    aliases: ["phone", "phone_number", "telephone", "mobile", "cell"],
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
  { field: "notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks"] },
];

export const CUSTOMER_IMPORT_CONFIG: CsvImportConfig<CustomerField> = {
  entity: { singular: "customer", plural: "customers" },
  description:
    "Bring customers in from QuickBooks, Excel, or any other CSV. We'll match columns to StoneDash fields automatically — fix any that look wrong before importing.",
  fields: CUSTOMER_IMPORT_FIELDS,
  commitEndpoint: "/api/import/customers",
};
