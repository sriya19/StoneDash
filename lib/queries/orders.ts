import type { OrderStage } from "@prisma/client";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  updated_at: string;
  customer_id: string | null;
  assigned_to: string | null;
  customers: { id: string; name: string; company: string | null } | null;
};

export type OrderListFilters = {
  stages?: OrderStage[];
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
  install: "scheduled_install_date",
  balance: "balance_due",
  updated: "updated_at",
  customer: "customer_id",
};

export async function listOrders(filters: OrderListFilters = {}) {
  const pageSize = filters.pageSize ?? 50;
  const page = Math.max(1, filters.page ?? 1);
  const sortKey = filters.sort ?? "updated";
  const dir = filters.dir === "asc" ? "asc" : "desc";
  const sortColumn = SORT_COLUMN_MAP[sortKey] ?? "updated_at";

  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select(
      "id, order_number, project_name, stage, priority, stone_type, scheduled_install_date, balance_due, quote_amount, updated_at, customer_id, assigned_to, customers(id, name, company)",
      { count: "exact" },
    );

  if (filters.stages && filters.stages.length > 0) {
    query = query.in("stage", filters.stages);
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

  const { data, count, error } = await query.returns<OrderListRow[]>();
  if (error) throw error;

  return {
    rows: data ?? [],
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

export async function getOrderDetail(id: string): Promise<OrderDetailRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, project_name, stage, priority, stone_type, edge_profile, sink_cutouts, cooktop_cutouts, estimated_sqft, quote_amount, deposit_received, balance_due, scheduled_install_date, measured_at, fabrication_start_date, installed_at, notes, assigned_to, created_by, created_at, updated_at, customer_id, customers(id, name, company)",
    )
    .eq("id", id)
    .maybeSingle<OrderDetailRow>();
  if (error) throw error;
  return data;
}
