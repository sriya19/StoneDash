import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CustomerListRow = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
};

export async function listCustomersLite(): Promise<CustomerListRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, company, phone, email")
    .order("name", { ascending: true })
    .limit(500)
    .returns<CustomerListRow[]>();
  if (error) throw error;
  return data ?? [];
}
