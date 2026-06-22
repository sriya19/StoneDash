// Client-safe orders import config. Orders differ from customers /
// contractors in three important ways that shape the field set:
//   1. customerName is required AND must resolve to an existing
//      customer in the org. The handler looks up by name; rows that
//      don't match skip with a clear warning. (Importing customers
//      first via /customers → Import CSV is the intended workflow.)
//   2. contractorName is optional and similarly resolved by name. A
//      mismatched contractor name produces a warning but doesn't skip
//      the row — the order still imports, just without the contractor
//      link.
//   3. scheduledInstallDate is parsed via parseFlexibleDate so the
//      user doesn't have to coerce dates to ISO before importing.

import type {
  CsvImportConfig,
  ImportFieldConfig,
} from "@/components/app/csv-import-sheet";

export type OrderField =
  | "customerName"
  | "projectName"
  | "contractorName"
  | "stoneType"
  | "edgeProfile"
  | "quoteAmount"
  | "depositReceived"
  | "stage"
  | "scheduledInstallDate"
  | "notes";

export const ORDER_IMPORT_FIELDS: ImportFieldConfig<OrderField>[] = [
  {
    field: "customerName",
    label: "Customer name",
    required: true,
    aliases: ["customer", "customer_name", "client", "client_name"],
  },
  {
    field: "projectName",
    label: "Project name",
    required: true,
    aliases: ["project", "project_name", "job", "job_name", "description"],
  },
  {
    field: "contractorName",
    label: "Contractor name",
    aliases: ["contractor", "contractor_name", "gc", "builder", "dealer"],
  },
  {
    field: "stoneType",
    label: "Stone type",
    aliases: ["stone", "stone_type", "material", "slab"],
  },
  {
    field: "edgeProfile",
    label: "Edge profile",
    aliases: ["edge", "edge_profile", "edge_type"],
  },
  {
    field: "quoteAmount",
    label: "Quote amount",
    aliases: ["quote", "quote_amount", "total", "amount", "price"],
  },
  {
    field: "depositReceived",
    label: "Deposit received",
    aliases: ["deposit", "deposit_received", "down_payment", "downpayment"],
  },
  {
    field: "stage",
    label: "Stage",
    aliases: ["stage", "status"],
  },
  {
    field: "scheduledInstallDate",
    label: "Install date",
    aliases: [
      "install_date",
      "scheduled_install_date",
      "install",
      "installation_date",
      "install_on",
    ],
  },
  {
    field: "notes",
    label: "Notes",
    aliases: ["notes", "note", "comments", "remarks"],
  },
];

export const ORDER_IMPORT_CONFIG: CsvImportConfig<OrderField> = {
  entity: { singular: "order", plural: "orders" },
  description:
    "Bring orders in from a spreadsheet. Customers and contractors are matched by name — make sure they exist in StoneDash first (use the customers / contractors imports if not). Install dates accept MM/DD/YYYY, YYYY-MM-DD, Jun 15 2026, and similar.",
  fields: ORDER_IMPORT_FIELDS,
  commitEndpoint: "/api/import/orders",
};
