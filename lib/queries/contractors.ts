import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dateInTimeZone } from "@/lib/tz";

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

export type ContractorDetail = {
  id: string;
  name: string;
  primaryContact: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  balance: {
    jobsTotal: number;
    paidTotal: number;
    balanceOwed: number;
    jobCount: number;
    activeJobCount: number;
  };
  paymentCount: number;
};

type ContractorDetailRow = {
  id: string;
  org_id: string;
  name: string;
  primary_contact: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  payment_terms: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export async function getContractorDetail(
  id: string,
): Promise<ContractorDetail | null> {
  const supabase = createSupabaseServerClient();
  const [contractorRes, balanceRes, paymentCountRes] = await Promise.all([
    supabase
      .from("contractors")
      .select(
        "id, org_id, name, primary_contact, phone, email, address_line1, address_line2, city, state, postal_code, payment_terms, notes, is_active, created_at",
      )
      .eq("id", id)
      .maybeSingle<ContractorDetailRow>(),
    supabase
      .from("v_contractor_balances")
      .select("jobs_total, paid_total, balance_owed, job_count, active_job_count")
      .eq("contractor_id", id)
      .maybeSingle<BalanceRow>(),
    supabase
      .from("contractor_payments")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", id),
  ]);
  if (contractorRes.error) throw contractorRes.error;
  if (balanceRes.error) throw balanceRes.error;
  if (paymentCountRes.error) throw paymentCountRes.error;
  if (!contractorRes.data) return null;

  const c = contractorRes.data;
  const b = balanceRes.data;
  return {
    id: c.id,
    name: c.name,
    primaryContact: c.primary_contact,
    phone: c.phone,
    email: c.email,
    addressLine1: c.address_line1,
    addressLine2: c.address_line2,
    city: c.city,
    state: c.state,
    postalCode: c.postal_code,
    paymentTerms: c.payment_terms,
    notes: c.notes,
    isActive: c.is_active,
    createdAt: c.created_at,
    balance: {
      jobsTotal: toMoney(b?.jobs_total),
      paidTotal: toMoney(b?.paid_total),
      balanceOwed: toMoney(b?.balance_owed),
      jobCount: toCount(b?.job_count),
      activeJobCount: toCount(b?.active_job_count),
    },
    paymentCount: paymentCountRes.count ?? 0,
  };
}

export type ContractorJob = {
  id: string;
  orderNumber: string;
  projectName: string | null;
  stage: string;
  quoteAmount: number;
  paidByContractor: number;
  contractorBalance: number;
  scheduledInstallDate: string | null;
  customerName: string | null;
};

type ContractorJobRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: string;
  quote_amount: string | null;
  next_install_at: string | null;
  customers: { id: string; name: string } | null;
};

export async function listContractorJobs(
  contractorId: string,
  timeZone: string,
): Promise<ContractorJob[]> {
  const supabase = createSupabaseServerClient();
  const [ordersRes, paidRes] = await Promise.all([
    supabase
      .from("v_orders_with_event_dates")
      .select(
        "id, order_number, project_name, stage, quote_amount, next_install_at, customers(id, name)",
      )
      .eq("contractor_id", contractorId)
      .order("next_install_at", { ascending: true, nullsFirst: false })
      .returns<ContractorJobRow[]>(),
    supabase
      .from("v_order_contractor_paid")
      .select("order_id, paid_by_contractor")
      .returns<{ order_id: string; paid_by_contractor: string }[]>(),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (paidRes.error) throw paidRes.error;

  const paidByOrder = new Map(
    (paidRes.data ?? []).map((p) => [p.order_id, toMoney(p.paid_by_contractor)]),
  );

  return (ordersRes.data ?? []).map((o) => {
    const quote = toMoney(o.quote_amount);
    const paid = paidByOrder.get(o.id) ?? 0;
    return {
      id: o.id,
      orderNumber: o.order_number,
      projectName: o.project_name,
      stage: o.stage,
      quoteAmount: quote,
      paidByContractor: paid,
      contractorBalance: quote - paid,
      scheduledInstallDate: dateInTimeZone(o.next_install_at, timeZone),
      customerName: o.customers?.name ?? null,
    };
  });
}

export type ContractorPayment = {
  id: string;
  amount: number;
  receivedOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  allocations: {
    orderId: string;
    orderNumber: string;
    projectName: string | null;
    amount: number;
  }[];
};

type ContractorPaymentQueryRow = {
  id: string;
  amount: string;
  received_on: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  contractor_payment_allocations: {
    order_id: string;
    amount: string;
    orders: { order_number: string; project_name: string | null } | null;
  }[];
};

export async function listContractorPayments(
  contractorId: string,
): Promise<ContractorPayment[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contractor_payments")
    .select(
      "id, amount, received_on, method, reference, notes, created_at, contractor_payment_allocations(order_id, amount, orders(order_number, project_name))",
    )
    .eq("contractor_id", contractorId)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ContractorPaymentQueryRow[]>();
  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id,
    amount: toMoney(p.amount),
    receivedOn: p.received_on,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    createdAt: p.created_at,
    allocations: (p.contractor_payment_allocations ?? []).map((a) => ({
      orderId: a.order_id,
      orderNumber: a.orders?.order_number ?? "—",
      projectName: a.orders?.project_name ?? null,
      amount: toMoney(a.amount),
    })),
  }));
}

export async function getContractorPayment(
  paymentId: string,
): Promise<ContractorPayment | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("contractor_payments")
    .select(
      "id, amount, received_on, method, reference, notes, created_at, contractor_payment_allocations(order_id, amount, orders(order_number, project_name))",
    )
    .eq("id", paymentId)
    .maybeSingle<ContractorPaymentQueryRow>();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    amount: toMoney(data.amount),
    receivedOn: data.received_on,
    method: data.method,
    reference: data.reference,
    notes: data.notes,
    createdAt: data.created_at,
    allocations: (data.contractor_payment_allocations ?? []).map((a) => ({
      orderId: a.order_id,
      orderNumber: a.orders?.order_number ?? "—",
      projectName: a.orders?.project_name ?? null,
      amount: toMoney(a.amount),
    })),
  };
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
