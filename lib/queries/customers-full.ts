import type { OrderStage } from "@prisma/client";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateInTimeZone } from "@/lib/tz";

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

type CustomerOrderDbRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: OrderStage;
  next_install_at: string | null;
  balance_due: string;
  quote_amount: string | null;
  updated_at: string;
};

export async function getCustomerDetail(id: string, timeZone: string) {
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
      .from("v_orders_with_event_dates")
      .select(
        "id, order_number, project_name, stage, next_install_at, balance_due, quote_amount, updated_at",
      )
      .eq("customer_id", id)
      .order("updated_at", { ascending: false })
      .returns<CustomerOrderDbRow[]>(),
  ]);
  if (detail.error) throw detail.error;
  if (orders.error) throw orders.error;
  const orderRows: CustomerOrderRow[] = (orders.data ?? []).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    project_name: o.project_name,
    stage: o.stage,
    scheduled_install_date: dateInTimeZone(o.next_install_at, timeZone),
    balance_due: o.balance_due,
    quote_amount: o.quote_amount,
    updated_at: o.updated_at,
  }));
  return { detail: detail.data, orders: orderRows };
}
