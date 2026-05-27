import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CrewListRow = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  activeAssignmentCount: number;
  lastAssignmentAt: string | null;
};

export type CrewLite = {
  id: string;
  name: string;
  role: string | null;
  isActive: boolean;
};

type CrewRowDb = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

type AssignmentRowDb = {
  crew_member_id: string;
  order_events: { starts_at: string; status: string } | null;
};

export type ListCrewFilters = {
  activeOnly?: boolean;
  search?: string;
};

export async function listCrewMembersWithActivity(
  filters: ListCrewFilters = {},
): Promise<CrewListRow[]> {
  const supabase = createSupabaseServerClient();

  let crewQuery = supabase
    .from("crew_members")
    .select("id, name, role, phone, email, is_active");
  if (filters.activeOnly !== false) crewQuery = crewQuery.eq("is_active", true);

  const term = filters.search?.trim();
  if (term && term.length >= 2) {
    const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
    crewQuery = crewQuery.or(
      `name.ilike.${pattern},role.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    );
  }

  const { data: crew, error: crewErr } = await crewQuery
    .order("name", { ascending: true })
    .returns<CrewRowDb[]>();
  if (crewErr) throw crewErr;
  const crewRows = crew ?? [];
  if (crewRows.length === 0) return [];

  const ids = crewRows.map((c) => c.id);
  const { data: assignments, error: aErr } = await supabase
    .from("order_event_assignments")
    .select("crew_member_id, order_events!inner(starts_at, status)")
    .in("crew_member_id", ids)
    .returns<AssignmentRowDb[]>();
  if (aErr) throw aErr;

  const now = new Date().toISOString();
  const activeByCrew = new Map<string, number>();
  const lastByCrew = new Map<string, string>();

  for (const row of assignments ?? []) {
    const ev = row.order_events;
    if (!ev) continue;
    // Active = future + not in a terminal status.
    if (ev.starts_at >= now && !["cancelled", "no_show", "complete"].includes(ev.status)) {
      activeByCrew.set(row.crew_member_id, (activeByCrew.get(row.crew_member_id) ?? 0) + 1);
    }
    // Last assignment = MAX(starts_at) regardless of status.
    const prev = lastByCrew.get(row.crew_member_id);
    if (!prev || ev.starts_at > prev) lastByCrew.set(row.crew_member_id, ev.starts_at);
  }

  return crewRows.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
    isActive: c.is_active,
    activeAssignmentCount: activeByCrew.get(c.id) ?? 0,
    lastAssignmentAt: lastByCrew.get(c.id) ?? null,
  }));
}

export type CrewDetail = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  totalAssignmentCount: number;
  activeAssignmentCount: number;
  lastAssignmentAt: string | null;
  history: CrewHistoryRow[];
};

export type CrewHistoryRow = {
  eventId: string;
  startsAt: string;
  kind: string;
  status: string;
  orderId: string;
  orderNumber: string;
  projectName: string | null;
  customerName: string | null;
  role: string | null;
};

type DetailDb = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

type HistoryDb = {
  role: string | null;
  order_events: {
    id: string;
    starts_at: string;
    kind: string;
    status: string;
    orders: {
      id: string;
      order_number: string;
      project_name: string | null;
      customers: { name: string } | null;
    } | null;
  } | null;
};

export async function getCrewMemberDetail(id: string): Promise<CrewDetail | null> {
  const supabase = createSupabaseServerClient();

  const [crewRes, historyRes] = await Promise.all([
    supabase
      .from("crew_members")
      .select("id, name, role, phone, email, notes, is_active, created_at")
      .eq("id", id)
      .maybeSingle<DetailDb>(),
    supabase
      .from("order_event_assignments")
      .select(
        "role, order_events!inner(id, starts_at, kind, status, orders!inner(id, order_number, project_name, customers(name)))",
      )
      .eq("crew_member_id", id)
      .order("starts_at", { ascending: false, foreignTable: "order_events" })
      .limit(30)
      .returns<HistoryDb[]>(),
  ]);
  if (crewRes.error) throw crewRes.error;
  if (historyRes.error) throw historyRes.error;
  if (!crewRes.data) return null;

  const c = crewRes.data;
  const history: CrewHistoryRow[] = [];
  const now = new Date().toISOString();
  let activeCount = 0;
  let lastAt: string | null = null;

  for (const row of historyRes.data ?? []) {
    const ev = row.order_events;
    if (!ev || !ev.orders) continue;
    history.push({
      eventId: ev.id,
      startsAt: ev.starts_at,
      kind: ev.kind,
      status: ev.status,
      orderId: ev.orders.id,
      orderNumber: ev.orders.order_number,
      projectName: ev.orders.project_name,
      customerName: ev.orders.customers?.name ?? null,
      role: row.role,
    });
    if (ev.starts_at >= now && !["cancelled", "no_show", "complete"].includes(ev.status)) {
      activeCount++;
    }
    if (!lastAt || ev.starts_at > lastAt) lastAt = ev.starts_at;
  }

  // Total count of assignments (may exceed the 30 in history; needed for the
  // delete gate which blocks if ANY assignment exists).
  const { count: totalCount } = await supabase
    .from("order_event_assignments")
    .select("id", { count: "exact", head: true })
    .eq("crew_member_id", id);

  return {
    id: c.id,
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    isActive: c.is_active,
    createdAt: c.created_at,
    totalAssignmentCount: totalCount ?? 0,
    activeAssignmentCount: activeCount,
    lastAssignmentAt: lastAt,
    history,
  };
}

export async function listCrewLite(activeOnly = true): Promise<CrewLite[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("crew_members").select("id, name, role, is_active");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query
    .order("name", { ascending: true })
    .returns<{ id: string; name: string; role: string | null; is_active: boolean }[]>();
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    isActive: c.is_active,
  }));
}
