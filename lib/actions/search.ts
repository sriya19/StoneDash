"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SearchHit =
  | {
      kind: "order";
      id: string;
      orderNumber: string;
      projectName: string | null;
      customerName: string | null;
      stage: string;
    }
  | {
      kind: "customer";
      id: string;
      name: string;
      company: string | null;
    };

type OrderJoinRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: string;
  customers: { name: string } | null;
};

type CustomerRow = {
  id: string;
  name: string;
  company: string | null;
};

// Global ⌘K search. Matches orders by order_number / project_name /
// customer name, and customers by name / company. Capped at 8 results
// per kind to keep the palette snappy. RLS restricts to the caller's orgs.
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
  const supabase = createSupabaseServerClient();

  const [ordersRes, customersRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, project_name, stage, customers(name)")
      .or(`order_number.ilike.${pattern},project_name.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(8)
      .returns<OrderJoinRow[]>(),
    supabase
      .from("customers")
      .select("id, name, company")
      .or(`name.ilike.${pattern},company.ilike.${pattern}`)
      .order("name", { ascending: true })
      .limit(8)
      .returns<CustomerRow[]>(),
  ]);

  const hits: SearchHit[] = [];
  if (ordersRes.data) {
    for (const row of ordersRes.data) {
      hits.push({
        kind: "order",
        id: row.id,
        orderNumber: row.order_number,
        projectName: row.project_name,
        customerName: row.customers?.name ?? null,
        stage: row.stage,
      });
    }
  }
  if (customersRes.data) {
    for (const row of customersRes.data) {
      hits.push({
        kind: "customer",
        id: row.id,
        name: row.name,
        company: row.company,
      });
    }
  }
  return hits;
}
