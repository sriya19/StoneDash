// Row type definitions for Supabase table queries.
//
// These mirror the Postgres schema in /supabase/migrations/0001_init.sql
// (snake_case column names, nullable where the SQL is nullable). They're
// used as the generic argument to supabase.from(...).select<T>() and
// .returns<T[]>() so the JS client returns typed rows without depending on
// Supabase's codegen (`supabase gen types`) which needs a live DB.
//
// If this file ever drifts from the DB, run `pnpm db:pull` and reconcile.

import type {
  AttachmentKind,
  MemberRole,
  OrderPriority,
  OrderStage,
} from "@prisma/client";

export type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  active_org_id: string | null;
  theme: string;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  timezone: string;
  currency: string;
  order_prefix: string;
  order_seq_start: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type OrgMemberRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  role: MemberRole;
  invited_email: string | null;
  invite_token: string | null;
  invite_accepted_at: string | null;
  created_at: string;
};

export type CustomerRow = {
  id: string;
  org_id: string;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  org_id: string;
  order_number: string;
  customer_id: string | null;
  project_name: string | null;
  stage: OrderStage;
  priority: OrderPriority;
  stone_type: string | null;
  edge_profile: string | null;
  sink_cutouts: number;
  cooktop_cutouts: number;
  estimated_sqft: string | null;
  quote_amount: string | null;
  deposit_received: string;
  balance_due: string;
  measured_at: string | null;
  fabrication_start_date: string | null;
  scheduled_install_date: string | null;
  installed_at: string | null;
  notes: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderStageHistoryRow = {
  id: string;
  order_id: string;
  from_stage: OrderStage | null;
  to_stage: OrderStage;
  changed_by: string | null;
  note: string | null;
  created_at: string;
};

export type OrderAttachmentRow = {
  id: string;
  org_id: string;
  order_id: string;
  storage_path: string;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  kind: AttachmentKind;
  uploaded_by: string | null;
  created_at: string;
};

export type ActivityLogRow = {
  id: string;
  org_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Task 5 — file_extractions + reminders. Kept hand-typed rather than
// pulled from Prisma so we don't couple runtime shape to `pnpm db:pull`
// timing — the migration lands at 0018_extractions.sql; these rows
// describe the same columns.

export type ReminderKind =
  | "license_expiry"
  | "insurance_expiry"
  | "invoice_due"
  | "custom";

export type ReminderSourceType =
  | "file_extraction"
  | "manual"
  | "contractor"
  | "order";

export type ReminderRow = {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  body: string | null;
  remind_at: string;
  kind: ReminderKind;
  source_type: ReminderSourceType | null;
  source_id: string | null;
  link_url: string | null;
  dismissed_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ExtractionDocumentType =
  | "template"
  | "contract"
  | "invoice"
  | "license"
  | "insurance"
  | "other";

export type ExtractionStatus =
  | "processing"
  | "review"
  | "confirmed"
  | "declined"
  | "failed";

export type ExtractionConfidence = "high" | "medium" | "low";

export type FileExtractionRow = {
  id: string;
  org_id: string;
  file_id: string;
  document_type: ExtractionDocumentType;
  status: ExtractionStatus;
  raw_response: Record<string, unknown> | null;
  extracted_fields: Record<string, unknown> | null;
  confidence: ExtractionConfidence | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_actions: unknown[] | null;
  error_message: string | null;
  cost_cents: number | null;
  created_at: string;
  updated_at: string;
};
