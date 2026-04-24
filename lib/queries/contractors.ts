import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ContractorListRow = {
  id: string;
  name: string;
  primaryContact: string | null;
  phone: string | null;
  email: string | null;
  paymentTerms: string | null;
  isActive: boolean;
  jobsTotal: number;
  paidTotal: number;
  balanceOwed: number;
  jobCount: number;
  activeJobCount: number;
  lastPaymentOn: string | null;
};

export type ContractorLite = {
  id: string;
  name: string;
  isActive: boolean;
};

type ContractorRow = {
  id: string;
  name: string;
  primary_contact: string | null;
  phone: string | null;
  email: string | null;
  payment_terms: string | null;
  is_active: boolean;
};

type BalanceRow = {
  contractor_id: string;
  jobs_total: string | null;
  paid_total: string | null;
  balance_owed: string | null;
  job_count: string | number | null;
  active_job_count: string | number | null;
};

type LastPaymentRow = {
  contractor_id: string;
  received_on: string;
};

function toMoney(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function toCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

export type ListContractorsFilters = {
  activeOnly?: boolean;
  search?: string;
};

export async function listContractorsWithBalance(
  filters: ListContractorsFilters = {},
): Promise<ContractorListRow[]> {
  const supabase = createSupabaseServerClient();

  // Fetch contractors, balances, and the last payment date per contractor
  // in parallel — then stitch client-side. Supabase !inner joins against
  // views are finicky, and three small parallel queries are cheaper than
  // one clever one here.
  let contractorsQuery = supabase
    .from("contractors")
    .select("id, name, primary_contact, phone, email, payment_terms, is_active");
  if (filters.activeOnly !== false) {
    contractorsQuery = contractorsQuery.eq("is_active", true);
  }
  const term = filters.search?.trim();
  if (term && term.length >= 2) {
    const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
    contractorsQuery = contractorsQuery.or(
      `name.ilike.${pattern},primary_contact.ilike.${pattern}`,
    );
  }
  const contractorsRes = await contractorsQuery
    .order("name", { ascending: true })
    .returns<ContractorRow[]>();
  if (contractorsRes.error) throw contractorsRes.error;
  const contractorRows = contractorsRes.data ?? [];
  if (contractorRows.length === 0) return [];

  const ids = contractorRows.map((c) => c.id);

  const [balancesRes, paymentsRes] = await Promise.all([
    supabase
      .from("v_contractor_balances")
      .select("contractor_id, jobs_total, paid_total, balance_owed, job_count, active_job_count")
      .in("contractor_id", ids)
      .returns<BalanceRow[]>(),
    supabase
      .from("contractor_payments")
      .select("contractor_id, received_on")
      .in("contractor_id", ids)
      .order("received_on", { ascending: false })
      .returns<LastPaymentRow[]>(),
  ]);
  if (balancesRes.error) throw balancesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const balanceByContractor = new Map(
    (balancesRes.data ?? []).map((b) => [b.contractor_id, b]),
  );
  // First occurrence of each contractor in the descending-received list is
  // the most recent payment.
  const lastPaymentByContractor = new Map<string, string>();
  for (const p of paymentsRes.data ?? []) {
    if (!lastPaymentByContractor.has(p.contractor_id)) {
      lastPaymentByContractor.set(p.contractor_id, p.received_on);
    }
  }

  return contractorRows.map((c) => {
    const b = balanceByContractor.get(c.id);
    return {
      id: c.id,
      name: c.name,
      primaryContact: c.primary_contact,
      phone: c.phone,
      email: c.email,
      paymentTerms: c.payment_terms,
      isActive: c.is_active,
      jobsTotal: toMoney(b?.jobs_total),
      paidTotal: toMoney(b?.paid_total),
      balanceOwed: toMoney(b?.balance_owed),
      jobCount: toCount(b?.job_count),
      activeJobCount: toCount(b?.active_job_count),
      lastPaymentOn: lastPaymentByContractor.get(c.id) ?? null,
    };
  });
}

export async function listContractorsLite(
  activeOnly = true,
): Promise<ContractorLite[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("contractors").select("id, name, is_active");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query
    .order("name", { ascending: true })
    .returns<{ id: string; name: string; is_active: boolean }[]>();
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    isActive: c.is_active,
  }));
}
