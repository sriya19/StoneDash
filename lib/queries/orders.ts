import type { OrderStage } from "@prisma/client";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateInTimeZone } from "@/lib/tz";

// scheduled_install_date and measured_at on the row types stay YYYY-MM-DD
// strings, same as before — but the values are now derived from the
// next install/measurement event (via v_orders_with_event_dates) and
// formatted in the org's timezone. Per PLAN Q5/Q13 the legacy columns
// on orders are no longer authoritative; the events table is.

export type OrderListRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: OrderStage;
  priority: string;
  stone_type: string | null;
  scheduled_install_date: string | null;
  balance_due: string;
  quote_amount: string | null;
  notes: string | null;
  updated_at: string;
  customer_id: string | null;
  contractor_id: string | null;
  assigned_to: string | null;
  customers: { id: string; name: string; company: string | null } | null;
  contractors: { id: string; name: string } | null;
};

export type OrderListFilters = {
  stages?: OrderStage[];
  contractorIds?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
};

const SORT_COLUMN_MAP: Record<string, string> = {
  orderNumber: "order_number",
  project: "project_name",
  stage: "stage",
  install: "next_install_at",
  balance: "balance_due",
  updated: "updated_at",
  customer: "customer_id",
};

type ListOrdersDbRow = OrderListRow & { next_install_at: string | null };

export async function listOrders(filters: OrderListFilters = {}, timeZone: string) {
  const pageSize = filters.pageSize ?? 50;
  const page = Math.max(1, filters.page ?? 1);
  const sortKey = filters.sort ?? "updated";
  const dir = filters.dir === "asc" ? "asc" : "desc";
  const sortColumn = SORT_COLUMN_MAP[sortKey] ?? "updated_at";

  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("v_orders_with_event_dates")
    .select(
      "id, order_number, project_name, stage, priority, stone_type, next_install_at, balance_due, quote_amount, notes, updated_at, customer_id, contractor_id, assigned_to, customers(id, name, company), contractors(id, name)",
      { count: "exact" },
    );

  if (filters.stages && filters.stages.length > 0) {
    query = query.in("stage", filters.stages);
  }

  if (filters.contractorIds && filters.contractorIds.length > 0) {
    query = query.in("contractor_id", filters.contractorIds);
  }

  const term = filters.search?.trim();
  if (term && term.length >= 2) {
    const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(
      `order_number.ilike.${pattern},project_name.ilike.${pattern}`,
    );
  }

  query = query
    .order(sortColumn, { ascending: dir === "asc", nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query.returns<ListOrdersDbRow[]>();
  if (error) throw error;

  const rows: OrderListRow[] = (data ?? []).map((r) => ({
    id: r.id,
    order_number: r.order_number,
    project_name: r.project_name,
    stage: r.stage,
    priority: r.priority,
    stone_type: r.stone_type,
    scheduled_install_date: dateInTimeZone(r.next_install_at, timeZone),
    balance_due: r.balance_due,
    quote_amount: r.quote_amount,
    notes: r.notes,
    updated_at: r.updated_at,
    customer_id: r.customer_id,
    contractor_id: r.contractor_id,
    assigned_to: r.assigned_to,
    customers: r.customers,
    contractors: r.contractors,
  }));

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize,
  };
}

export type OrderDetailRow = OrderListRow & {
  edge_profile: string | null;
  sink_cutouts: number;
  cooktop_cutouts: number;
  estimated_sqft: string | null;
  deposit_received: string;
  measured_at: string | null;
  fabrication_start_date: string | null;
  installed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

type DetailDbRow = OrderListRow & {
  edge_profile: string | null;
  sink_cutouts: number;
  cooktop_cutouts: number;
  estimated_sqft: string | null;
  deposit_received: string;
  next_install_at: string | null;
  next_measurement_at: string | null;
  fabrication_start_date: string | null;
  installed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type LastNotesEdit = {
  actorName: string | null;
  at: string;
};

export async function getOrderDetail(
  id: string,
  timeZone: string,
): Promise<{ detail: OrderDetailRow | null; lastNotesEdit: LastNotesEdit | null }> {
  const supabase = createSupabaseServerClient();
  const [orderRes, editRes] = await Promise.all([
    supabase
      .from("v_orders_with_event_dates")
      .select(
        "id, order_number, project_name, stage, priority, stone_type, edge_profile, sink_cutouts, cooktop_cutouts, estimated_sqft, quote_amount, deposit_received, balance_due, next_install_at, next_measurement_at, fabrication_start_date, installed_at, notes, assigned_to, created_by, created_at, updated_at, customer_id, contractor_id, customers(id, name, company), contractors(id, name)",
      )
      .eq("id", id)
      .maybeSingle<DetailDbRow>(),
    supabase
      .from("activity_log")
      .select("actor_id, created_at")
      .eq("entity_type", "order")
      .eq("entity_id", id)
      .eq("action", "notes_updated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ actor_id: string | null; created_at: string }>(),
  ]);
  if (orderRes.error) throw orderRes.error;
  if (editRes.error) throw editRes.error;

  let detail: OrderDetailRow | null = null;
  if (orderRes.data) {
    const r = orderRes.data;
    detail = {
      id: r.id,
      order_number: r.order_number,
      project_name: r.project_name,
      stage: r.stage,
      priority: r.priority,
      stone_type: r.stone_type,
      edge_profile: r.edge_profile,
      sink_cutouts: r.sink_cutouts,
      cooktop_cutouts: r.cooktop_cutouts,
      estimated_sqft: r.estimated_sqft,
      quote_amount: r.quote_amount,
      deposit_received: r.deposit_received,
      balance_due: r.balance_due,
      scheduled_install_date: dateInTimeZone(r.next_install_at, timeZone),
      measured_at: dateInTimeZone(r.next_measurement_at, timeZone),
      fabrication_start_date: r.fabrication_start_date,
      installed_at: r.installed_at,
      notes: r.notes,
      assigned_to: r.assigned_to,
      created_by: r.created_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      customer_id: r.customer_id,
      contractor_id: r.contractor_id,
      customers: r.customers,
      contractors: r.contractors,
    };
  }

  let lastNotesEdit: LastNotesEdit | null = null;
  if (editRes.data) {
    let actorName: string | null = null;
    if (editRes.data.actor_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", editRes.data.actor_id)
        .maybeSingle<{ full_name: string | null }>();
      actorName = profile?.full_name ?? null;
    }
    lastNotesEdit = { actorName, at: editRes.data.created_at };
  }

  return { detail, lastNotesEdit };
}
