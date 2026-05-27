import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ShareLinkRow = {
  id: string;
  slug: string;
  createdAt: string;
  revokedAt: string | null;
  lastOpenedAt: string | null;
};

type ShareLinkDb = {
  id: string;
  slug: string;
  created_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
};

// One live link per event by convention (enforced by create_event_share_link
// RPC). Returns the live one if it exists, else null. Revoked links are not
// returned — once they're dead they stay dead.
export async function getLiveLinkForEvent(eventId: string): Promise<ShareLinkRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_share_links")
    .select("id, slug, created_at, revoked_at, last_opened_at")
    .eq("event_id", eventId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ShareLinkDb>();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    createdAt: data.created_at,
    revokedAt: data.revoked_at,
    lastOpenedAt: data.last_opened_at,
  };
}

// Bundled fetch for the send-to-crew modal: event + extra order fields
// not in v_calendar_events + customer details + any live share link.
// Returns null if the event doesn't exist or isn't readable under RLS.
export type SendModalContext = {
  event: {
    id: string;
    orderId: string;
    kind: string;
    startsAt: string;
    durationMin: number;
    locationText: string | null;
    notes: string | null;
  };
  order: {
    orderNumber: string;
    projectName: string | null;
    stoneType: string | null;
    edgeProfile: string | null;
    sinkCutouts: number;
    cooktopCutouts: number;
  };
  customer: {
    name: string | null;
    phone: string | null;
  };
  link: ShareLinkRow | null;
};

type EventForModalDb = {
  id: string;
  order_id: string;
  kind: string;
  starts_at: string;
  duration_min: number;
  location_text: string | null;
  notes: string | null;
  orders: {
    order_number: string;
    project_name: string | null;
    stone_type: string | null;
    edge_profile: string | null;
    sink_cutouts: number;
    cooktop_cutouts: number;
    customers: { name: string | null; phone: string | null } | null;
  } | null;
};

export async function getSendModalContext(
  eventId: string,
): Promise<SendModalContext | null> {
  const supabase = createSupabaseServerClient();
  const [eventRes, linkRow] = await Promise.all([
    supabase
      .from("order_events")
      .select(
        "id, order_id, kind, starts_at, duration_min, location_text, notes, orders!inner(order_number, project_name, stone_type, edge_profile, sink_cutouts, cooktop_cutouts, customers(name, phone))",
      )
      .eq("id", eventId)
      .maybeSingle<EventForModalDb>(),
    getLiveLinkForEvent(eventId),
  ]);
  if (eventRes.error) throw eventRes.error;
  const e = eventRes.data;
  if (!e || !e.orders) return null;

  return {
    event: {
      id: e.id,
      orderId: e.order_id,
      kind: e.kind,
      startsAt: e.starts_at,
      durationMin: e.duration_min,
      locationText: e.location_text,
      notes: e.notes,
    },
    order: {
      orderNumber: e.orders.order_number,
      projectName: e.orders.project_name,
      stoneType: e.orders.stone_type,
      edgeProfile: e.orders.edge_profile,
      sinkCutouts: e.orders.sink_cutouts,
      cooktopCutouts: e.orders.cooktop_cutouts,
    },
    customer: {
      name: e.orders.customers?.name ?? null,
      phone: e.orders.customers?.phone ?? null,
    },
    link: linkRow,
  };
}
