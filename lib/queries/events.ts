import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CalendarEventCrew = {
  id: string;
  name: string;
  role: string | null;
};

export type CalendarEvent = {
  id: string;
  orderId: string;
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  locationText: string | null;
  notes: string | null;
  orderNumber: string;
  projectName: string | null;
  stoneType: string | null;
  stage: string;
  contractorId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  contractorName: string | null;
  crew: CalendarEventCrew[];
};

type CalendarEventDb = {
  id: string;
  order_id: string;
  kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  location_text: string | null;
  notes: string | null;
  order_number: string;
  project_name: string | null;
  stone_type: string | null;
  stage: string;
  contractor_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  contractor_name: string | null;
  crew: CalendarEventCrew[];
};

export type ListCalendarEventsFilters = {
  fromUtc: string; // ISO timestamp lower bound (inclusive)
  toUtc: string; // ISO timestamp upper bound (exclusive)
  kinds?: string[];
  crewIds?: string[];
  statuses?: string[];
  search?: string;
};

export async function listCalendarEvents(
  filters: ListCalendarEventsFilters,
): Promise<CalendarEvent[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("v_calendar_events")
    .select(
      "id, order_id, kind, status, starts_at, ends_at, duration_min, location_text, notes, order_number, project_name, stone_type, stage, contractor_id, customer_name, customer_phone, contractor_name, crew",
    )
    .gte("starts_at", filters.fromUtc)
    .lt("starts_at", filters.toUtc);

  if (filters.kinds && filters.kinds.length > 0) query = query.in("kind", filters.kinds);
  if (filters.statuses && filters.statuses.length > 0) query = query.in("status", filters.statuses);

  const term = filters.search?.trim();
  if (term && term.length >= 2) {
    const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(
      `order_number.ilike.${pattern},project_name.ilike.${pattern},customer_name.ilike.${pattern}`,
    );
  }

  const { data, error } = await query
    .order("starts_at", { ascending: true })
    .returns<CalendarEventDb[]>();
  if (error) throw error;

  let rows = (data ?? []).map(
    (r): CalendarEvent => ({
      id: r.id,
      orderId: r.order_id,
      kind: r.kind,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      durationMin: r.duration_min,
      locationText: r.location_text,
      notes: r.notes,
      orderNumber: r.order_number,
      projectName: r.project_name,
      stoneType: r.stone_type,
      stage: r.stage,
      contractorId: r.contractor_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      contractorName: r.contractor_name,
      crew: Array.isArray(r.crew) ? r.crew : [],
    }),
  );

  // Crew filter is applied in JS — the view's `crew` is a jsonb array and
  // PostgREST doesn't easily filter inside that. Bounded by the time
  // window query above, so the in-memory pass is cheap.
  if (filters.crewIds && filters.crewIds.length > 0) {
    const wanted = new Set(filters.crewIds);
    rows = rows.filter((ev) => ev.crew.some((c) => wanted.has(c.id)));
  }

  return rows;
}

// Fetched once on the schedule page and passed to the dialog so the order
// picker can show name + auto-fill location_text from the customer address.
export type OrderForEventPicker = {
  id: string;
  orderNumber: string;
  projectName: string | null;
  stage: string;
  customerName: string | null;
  defaultLocation: string | null;
};

type OrderPickerDb = {
  id: string;
  order_number: string;
  project_name: string | null;
  stage: string;
  customers: {
    name: string;
    address_line1: string | null;
    city: string | null;
    state: string | null;
  } | null;
};

function composeAddress(
  line1: string | null,
  city: string | null,
  state: string | null,
): string | null {
  const parts = [line1, [city, state].filter(Boolean).join(", ")].filter(
    (p) => p && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function listOrdersForEventPicker(): Promise<OrderForEventPicker[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, project_name, stage, customers(name, address_line1, city, state)",
    )
    .not("stage", "in", "(paid,cancelled)")
    .order("order_number", { ascending: false })
    .returns<OrderPickerDb[]>();
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    projectName: o.project_name,
    stage: o.stage,
    customerName: o.customers?.name ?? null,
    defaultLocation: composeAddress(
      o.customers?.address_line1 ?? null,
      o.customers?.city ?? null,
      o.customers?.state ?? null,
    ),
  }));
}

// Single-event fetch for the edit dialog.
export async function getEventForEdit(id: string): Promise<CalendarEvent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_calendar_events")
    .select(
      "id, order_id, kind, status, starts_at, ends_at, duration_min, location_text, notes, order_number, project_name, stone_type, stage, contractor_id, customer_name, customer_phone, contractor_name, crew",
    )
    .eq("id", id)
    .maybeSingle<CalendarEventDb>();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    orderId: data.order_id,
    kind: data.kind,
    status: data.status,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    durationMin: data.duration_min,
    locationText: data.location_text,
    notes: data.notes,
    orderNumber: data.order_number,
    projectName: data.project_name,
    stoneType: data.stone_type,
    stage: data.stage,
    contractorId: data.contractor_id,
    customerName: data.customer_name,
    customerPhone: data.customer_phone,
    contractorName: data.contractor_name,
    crew: Array.isArray(data.crew) ? data.crew : [],
  };
}
