"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertNoQueryError } from "@/lib/supabase/query-error";
import {
  composeShopAddress,
  computeTravelTime,
  hasServerKey,
  isMockEta,
  shouldRecomputeEta,
} from "@/lib/eta/google-distance-matrix";

/**
 * Distinct from the shared ActionResult shape used elsewhere: the caller
 * needs to tell "we didn't compute" apart from "it blew up", because the
 * former is a supported configuration that should quietly reveal the manual
 * ETA input rather than surface an error toast.
 */
export type EtaResult =
  | { ok: true; minutes: number; distanceMeters: number; cached: boolean }
  | {
      ok: false;
      reason:
        | "missing_key"
        | "missing_shop_address"
        | "missing_site_address"
        | "no_route"
        | "not_found";
    };

const IdInput = z.object({ orderId: z.string().uuid() });

type OrderEtaRow = {
  id: string;
  org_id: string;
  customer_id: string | null;
  estimated_travel_min: number | null;
  estimated_travel_meters: number | null;
  estimated_travel_computed_at: string | null;
};

type CustomerAddressRow = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

/**
 * Destination resolution mirrors buildMessageContext's site_address rule
 * (PLAN.md Q6): the event's location_text wins where one exists, otherwise
 * the customer's structured address. Keeping the two in step matters — an
 * ETA computed to a different place than the message names would be worse
 * than no ETA at all.
 */
async function resolveSiteAddress(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  order: OrderEtaRow,
): Promise<string> {
  const { data: event, error: eventErr } = await supabase
    .from("order_events")
    .select("location_text")
    .eq("order_id", order.id)
    .eq("kind", "install")
    .not("location_text", "is", null)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ location_text: string | null }>();
  assertNoQueryError("refreshOrderEta:event", eventErr);
  if (event?.location_text?.trim()) return event.location_text.trim();

  if (!order.customer_id) return "";
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("address_line1, address_line2, city, state, postal_code")
    .eq("id", order.customer_id)
    .maybeSingle<CustomerAddressRow>();
  assertNoQueryError("refreshOrderEta:customer", custErr);
  if (!customer) return "";

  const street = [customer.address_line1, customer.address_line2]
    .filter(Boolean)
    .join(" ");
  const region = [customer.city, customer.state].filter(Boolean).join(", ");
  const tail = [region, customer.postal_code].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ").trim();
}

/**
 * Recompute and cache an order's travel time.
 *
 * `force` bypasses the cache policy — that's the "Refresh ETA" button. Without
 * it we only spend a call when the addresses changed, nothing is cached, or
 * the cached value is stale (PLAN.md Q11). This endpoint is billed per call.
 *
 * Never throws for a configuration problem: a missing key returns
 * { ok: false, reason: 'missing_key' } so the UI can reveal manual entry.
 */
export async function refreshOrderEta(
  input: unknown,
  options?: { force?: boolean },
): Promise<EtaResult> {
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_found" };

  // A missing key is a supported configuration, so answer before doing any
  // work — no query, no spend, no exception.
  if (!hasServerKey() && !isMockEta()) return { ok: false, reason: "missing_key" };

  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, org_id, customer_id, estimated_travel_min, estimated_travel_meters, estimated_travel_computed_at",
    )
    .eq("id", parsed.data.orderId)
    .eq("org_id", org.id)
    .maybeSingle<OrderEtaRow>();
  assertNoQueryError("refreshOrderEta:order", orderErr);
  if (!order) return { ok: false, reason: "not_found" };

  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("shop_address_line1, shop_city, shop_state, shop_postal_code")
    .eq("id", org.id)
    .maybeSingle<{
      shop_address_line1: string | null;
      shop_city: string | null;
      shop_state: string | null;
      shop_postal_code: string | null;
    }>();
  assertNoQueryError("refreshOrderEta:org", orgErr);

  const shopAddress = orgRow ? composeShopAddress(orgRow) : "";
  if (!shopAddress) return { ok: false, reason: "missing_shop_address" };

  const siteAddress = await resolveSiteAddress(supabase, order);
  if (!siteAddress) return { ok: false, reason: "missing_site_address" };

  // Cache policy. `force` is the explicit Refresh click; otherwise only
  // recompute when the cached answer could have changed.
  if (
    !options?.force &&
    !shouldRecomputeEta({
      computedAt: order.estimated_travel_computed_at,
      cachedMinutes: order.estimated_travel_min,
      addressesChanged: false,
    })
  ) {
    return {
      ok: true,
      minutes: order.estimated_travel_min!,
      distanceMeters: order.estimated_travel_meters ?? 0,
      cached: true,
    };
  }

  const travel = await computeTravelTime(shopAddress, siteAddress);
  if (!travel) return { ok: false, reason: "no_route" };

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      estimated_travel_min: travel.minutes,
      estimated_travel_meters: travel.distanceMeters,
      estimated_travel_computed_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (updateErr) return { ok: false, reason: "not_found" };

  revalidatePath("/orders");
  revalidatePath("/schedule");
  return {
    ok: true,
    minutes: travel.minutes,
    distanceMeters: travel.distanceMeters,
    cached: false,
  };
}

/**
 * Recompute every future install event's order after the shop address moves.
 *
 * A batch server action rather than a Postgres job: the volume is small (a
 * shop has tens of upcoming installs, not thousands) and a cron would need
 * infrastructure this project doesn't have. Bounded at 50 so a pathological
 * org can't turn one settings save into a hundred billed calls; anything
 * beyond that recomputes lazily on next use.
 */
export async function recomputeUpcomingEtas(): Promise<{ updated: number }> {
  if (!hasServerKey() && !isMockEta()) return { updated: 0 };

  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const { data: events, error } = await supabase
    .from("order_events")
    .select("order_id")
    .eq("org_id", org.id)
    .eq("kind", "install")
    .gte("starts_at", new Date().toISOString())
    .not("order_id", "is", null)
    .limit(50);
  assertNoQueryError("recomputeUpcomingEtas:events", error);

  const orderIds = Array.from(
    new Set((events ?? []).map((e) => e.order_id).filter(Boolean) as string[]),
  );

  let updated = 0;
  for (const orderId of orderIds) {
    // force: the address just changed, so every cached value is wrong.
    const result = await refreshOrderEta({ orderId }, { force: true });
    if (result.ok) updated += 1;
  }
  return { updated };
}
