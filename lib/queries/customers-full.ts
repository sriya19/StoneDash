import type { OrderStage } from "@prisma/client";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomerWithOrders = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  orders: Array<{ id: string; created_at: string }>;
};

export async function listCustomersWithOrderCount() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, company, email, phone, created_at, orders(id, created_at)")
    .order("name", { ascending: true })
    .returns<CustomerWithOrders[]>();
  if (error) throw error;
  return data ?? [];
}

export type CustomerDetailRow = {
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
  created_at: string;
  updated_at: string;
};

export type CustomerOrderRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: OrderStage;
  scheduled_install_date: string | null;
  balance_due: string;
  quote_amount: string | null;
  updated_at: string;
};

export async function getCustomerDetail(id: string) {
  const supabase = createSupabaseServerClient();
  const [detail, orders] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, org_id, name, company, email, phone, address_line1, address_line2, city, state, postal_code, notes, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle<CustomerDetailRow>(),
    supabase
      .from("orders")
      .select(
        "id, order_number, project_name, stage, scheduled_install_date, balance_due, quote_amount, updated_at",
      )
      .eq("customer_id", id)
      .order("updated_at", { ascending: false })
      .returns<CustomerOrderRow[]>(),
  ]);
  if (detail.error) throw detail.error;
  if (orders.error) throw orders.error;
  return { detail: detail.data, orders: orders.data ?? [] };
}
