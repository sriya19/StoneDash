// Builds the placeholder context a message template renders against.
//
// No "server-only" guard: the module takes a SupabaseClient rather than
// constructing one, so scripts/test_message_context.ts can drive it with the
// service-role client. Same posture as lib/intake/match.ts.
//
// Every value is a string (or null, which the renderer treats as empty and
// tidies around). Formatting decisions live here so the renderer can stay a
// pure string substitution.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoQueryError } from "@/lib/supabase/query-error";
import { formatInTimeZone } from "@/lib/tz";
import { EVENT_KIND_LABELS, type EventKind } from "@/lib/validators/events";
import type { TemplateContext } from "./render-template";

export type BuildContextInput = {
  /** Either is sufficient. An event resolves its own order when it has one. */
  eventId?: string | null;
  orderId?: string | null;
  /** Manual ETA when no cached travel time exists (PLAN.md Q2 fallback). */
  etaMinOverride?: number | null;
};

type OrgRow = {
  id: string;
  timezone: string;
  currency: string;
  phone: string | null;
  default_fabrication_days: number;
};

type EventRow = {
  id: string;
  org_id: string;
  order_id: string | null;
  kind: string;
  title: string | null;
  starts_at: string;
  duration_min: number;
  is_all_day: boolean;
  location_text: string | null;
  notes: string | null;
};

type OrderRow = {
  id: string;
  order_number: string;
  project_name: string | null;
  stone_type: string | null;
  edge_profile: string | null;
  sink_cutouts: number;
  cooktop_cutouts: number;
  balance_due: string | number | null;
  notes: string | null;
  customer_id: string | null;
  contractor_id: string | null;
  site_contact_name: string | null;
  site_contact_phone: string | null;
  site_contact_email: string | null;
  estimated_travel_min: number | null;
};

type CustomerRow = {
  name: string;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type ContractorRow = { name: string; phone: string | null; email: string | null };

/** "1 sink, 2 cooktop cutouts" — empty when the order has neither. */
function cutoutSummary(sink: number, cooktop: number): string {
  const parts: string[] = [];
  if (sink > 0) parts.push(`${sink} sink cutout${sink === 1 ? "" : "s"}`);
  if (cooktop > 0) {
    parts.push(`${cooktop} cooktop cutout${cooktop === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

/** "3h", "45m", "2h 30m" — or "All day" for an all-day event. */
function durationLabel(minutes: number, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Compose a customer's structured address into one line. */
function composeAddress(c: CustomerRow | null): string {
  if (!c) return "";
  const street = [c.address_line1, c.address_line2].filter(Boolean).join(" ");
  const region = [c.city, c.state].filter(Boolean).join(", ");
  const tail = [region, c.postal_code].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ");
}

function money(value: string | number | null, currency: string): string {
  if (value === null || value === undefined) return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Assemble the template context for an event and/or order.
 *
 * Resolution rules that matter:
 *   site_address        event.location_text → composed customer address → ""
 *                       (PLAN.md Q6 — the event location is the most
 *                       specific and most recently touched value)
 *   site_contact_*      order.site_contact_* → customer.* → ""
 *   event_time          "All day" for all-day events, per the Task 3.1
 *                       formatter convention of short-circuiting on the flag
 *   notes               event notes preferred over order notes — the crew
 *                       cares about this visit, not the whole job
 */
export async function buildMessageContext(
  supabase: SupabaseClient,
  input: BuildContextInput,
): Promise<TemplateContext> {
  let event: EventRow | null = null;
  let order: OrderRow | null = null;

  if (input.eventId) {
    const { data, error } = await supabase
      .from("order_events")
      .select(
        "id, org_id, order_id, kind, title, starts_at, duration_min, is_all_day, location_text, notes",
      )
      .eq("id", input.eventId)
      .maybeSingle<EventRow>();
    assertNoQueryError("buildMessageContext:event", error);
    event = data ?? null;
  }

  const orderId = input.orderId ?? event?.order_id ?? null;
  if (orderId) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, project_name, stone_type, edge_profile, sink_cutouts, " +
          "cooktop_cutouts, balance_due, notes, customer_id, contractor_id, " +
          "site_contact_name, site_contact_phone, site_contact_email, estimated_travel_min",
      )
      .eq("id", orderId)
      .maybeSingle<OrderRow>();
    assertNoQueryError("buildMessageContext:order", error);
    order = data ?? null;
  }

  // Org: from the event when we have one, otherwise via the order.
  let orgId = event?.org_id ?? null;
  if (!orgId && order) {
    const { data, error } = await supabase
      .from("orders")
      .select("org_id")
      .eq("id", order.id)
      .maybeSingle<{ org_id: string }>();
    assertNoQueryError("buildMessageContext:orderOrg", error);
    orgId = data?.org_id ?? null;
  }

  let org: OrgRow | null = null;
  if (orgId) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, timezone, currency, phone, default_fabrication_days")
      .eq("id", orgId)
      .maybeSingle<OrgRow>();
    assertNoQueryError("buildMessageContext:org", error);
    org = data ?? null;
  }
  const timeZone = org?.timezone ?? "America/New_York";
  const currency = org?.currency ?? "USD";

  let customer: CustomerRow | null = null;
  if (order?.customer_id) {
    const { data, error } = await supabase
      .from("customers")
      .select("name, phone, email, address_line1, address_line2, city, state, postal_code")
      .eq("id", order.customer_id)
      .maybeSingle<CustomerRow>();
    assertNoQueryError("buildMessageContext:customer", error);
    customer = data ?? null;
  }

  let contractor: ContractorRow | null = null;
  if (order?.contractor_id) {
    const { data, error } = await supabase
      .from("contractors")
      .select("name, phone, email")
      .eq("id", order.contractor_id)
      .maybeSingle<ContractorRow>();
    assertNoQueryError("buildMessageContext:contractor", error);
    contractor = data ?? null;
  }

  const etaMin = input.etaMinOverride ?? order?.estimated_travel_min ?? null;

  return {
    // Customer
    customer_name: customer?.name ?? "",
    customer_phone: customer?.phone ?? "",
    customer_email: customer?.email ?? "",

    // Site contact — order override wins, customer is the fallback
    site_contact_name: order?.site_contact_name ?? customer?.name ?? "",
    site_contact_phone: order?.site_contact_phone ?? customer?.phone ?? "",
    site_contact_email: order?.site_contact_email ?? customer?.email ?? "",

    // Contractor
    contractor_name: contractor?.name ?? "",
    contractor_phone: contractor?.phone ?? "",

    // Order
    order_number: order?.order_number ?? "",
    project_name: order?.project_name ?? event?.title ?? "",
    stone_type: order?.stone_type ?? "",
    edge_profile: order?.edge_profile ?? "",
    cutout_summary: order
      ? cutoutSummary(order.sink_cutouts, order.cooktop_cutouts)
      : "",
    balance_due: order ? money(order.balance_due, currency) : "",

    // Event
    event_kind: event
      ? (EVENT_KIND_LABELS[event.kind as EventKind] ?? "Event")
      : "",
    event_date: event
      ? formatInTimeZone(event.starts_at, timeZone, "EEE, MMM d")
      : "",
    event_time: event
      ? event.is_all_day
        ? "All day"
        : formatInTimeZone(event.starts_at, timeZone, "h:mm a")
      : "",
    event_datetime: event
      ? event.is_all_day
        ? `${formatInTimeZone(event.starts_at, timeZone, "EEE, MMM d")} (all day)`
        : formatInTimeZone(event.starts_at, timeZone, "EEE, MMM d 'at' h:mm a")
      : "",
    event_duration: event
      ? durationLabel(event.duration_min, event.is_all_day)
      : "",

    // Location — Q6 precedence
    site_address: event?.location_text || composeAddress(customer),

    // Shop
    shop_phone: org?.phone ?? "",
    // Org-wide typical fabrication turnaround (Task 9). NOT NULL DEFAULT 10
    // in the schema, so the `?? 10` only covers the no-org case that already
    // makes every other org-derived key empty. Deliberately not "" there:
    // "typical fabrication is  days" reads worse than a sane default, and
    // the renderer's empty-placeholder tidy cannot rescue a bare number.
    fabrication_days: String(org?.default_fabrication_days ?? 10),

    // Notes: this visit first, the job second
    notes: event?.notes ?? order?.notes ?? "",

    // ETA (cached, or the caller's manual entry)
    eta_min: etaMin === null ? "" : String(etaMin),
  };
}
