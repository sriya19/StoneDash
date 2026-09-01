// Travel-time lookup for customer ETA messages.
//
// Uses the Google **Routes API v2** `computeRouteMatrix` endpoint, not the
// legacy Distance Matrix API. Distance Matrix still responds but is on the
// deprecation track; Routes is the current product (PLAN.md Q2).
//
// KEY SEPARATION — the reason this file exists rather than reusing the
// browser key. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is HTTP-referrer restricted
// (mandatory, see .env.example and Task 3.1 Q8). Referrer restrictions are
// validated against the Referer header a *browser* sends; a fetch() from a
// server action sends none, so Google answers REQUEST_DENIED. Relaxing that
// restriction to make it work would leave an unrestricted key shipping in
// the client bundle — exactly the bill-running scenario the warning exists
// to prevent. So this module reads its own IP-restricted server key.
//
// Everything here degrades rather than throws. A missing key, a network
// failure, an unroutable pair — all return null, and the caller falls back
// to manual ETA entry.

// No "server-only" guard, deliberately — scripts/test_eta.ts drives this
// module directly, and `server-only` throws at import time under tsx. Same
// posture as lib/intake/match.ts.
//
// That is safe here: Next only inlines NEXT_PUBLIC_-prefixed variables into
// the client bundle, so GOOGLE_MAPS_SERVER_KEY cannot leak into the browser
// even if this module were imported from a client component — the lookup
// would simply find no key and degrade to null, which is the documented
// behaviour anyway. The guard would catch a mistake, not prevent a leak.
// Callers are server actions (lib/actions/eta.ts).

/** Recompute an ETA older than this many hours (PLAN.md Q11). */
export const ETA_STALE_HOURS = 72;

const ROUTE_MATRIX_ENDPOINT =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

export type TravelTime = {
  minutes: number;
  distanceMeters: number;
  source: "google" | "mock";
};

// One warning per process when the key is absent, mirroring the OPENAI_API_KEY
// pattern in lib/extraction/openai.ts. A warning, not an error: no key is a
// supported configuration — ETA simply becomes a manual field.
let missingKeyWarned = false;
function warnMissingKeyOnce(): void {
  if (missingKeyWarned) return;
  missingKeyWarned = true;
  process.stderr.write(
    "[eta] GOOGLE_MAPS_SERVER_KEY is not set. Travel-time computation is " +
      "disabled and ETA falls back to manual entry. This must be a " +
      "different key from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — see .env.example.\n",
  );
}

/**
 * True when the mock short-circuit is active (used by the smoke).
 *
 * Re-exported from lib/env/mock-guard.ts, which throws rather than
 * returning true in a production runtime. computeTravelTime checks this
 * ABOVE the real-key read, so without the guard MOCK_ETA=1 would beat a
 * correctly-configured GOOGLE_MAPS_SERVER_KEY.
 */
import { isMockEta } from "@/lib/env/mock-guard";

export { isMockEta };

/** True when a real lookup is possible. */
export function hasServerKey(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY);
}

/**
 * Deterministic stand-in for the paid API, active under MOCK_ETA=1.
 *
 * Derived from the input strings so a given origin/destination pair always
 * yields the same answer — a random value would make the smoke's assertions
 * unstable. 12–71 minutes is a plausible spread for a metro-area shop.
 */
function mockTravelTime(origin: string, destination: string): TravelTime {
  let hash = 0;
  for (const ch of `${origin}→${destination}`) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const minutes = 12 + (hash % 60);
  return { minutes, distanceMeters: minutes * 800, source: "mock" };
}

/**
 * Compute driving time between two free-text addresses.
 *
 * Returns null — never throws — when the key is missing, the request fails,
 * the pair is unroutable, or either address is blank. Callers treat null as
 * "ask the user to type a number".
 *
 * departureTime is 'now' with TRAFFIC_AWARE routing: at 3pm on a Tuesday the
 * honest number matters more than the shortest path.
 */
export async function computeTravelTime(
  originAddress: string | null | undefined,
  destinationAddress: string | null | undefined,
): Promise<TravelTime | null> {
  const origin = originAddress?.trim();
  const destination = destinationAddress?.trim();
  if (!origin || !destination) return null;

  if (isMockEta()) return mockTravelTime(origin, destination);

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    warnMissingKeyOnce();
    return null;
  }

  try {
    const res = await fetch(ROUTE_MATRIX_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Routes v2 requires an explicit field mask; without it the
        // response omits duration and the call is wasted.
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,status,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { address: origin } }],
        destinations: [{ waypoint: { address: destination } }],
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: new Date().toISOString(),
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    // computeRouteMatrix answers with an array of elements, one per
    // origin×destination pair. We asked for exactly one.
    const payload: unknown = await res.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (!first || typeof first !== "object") return null;

    const element = first as {
      condition?: string;
      duration?: string;
      distanceMeters?: number;
    };

    // ROUTE_NOT_FOUND and friends surface as a condition, not an HTTP error.
    if (element.condition && element.condition !== "ROUTE_EXISTS") return null;

    // Routes returns a protobuf Duration string: "1234s".
    const seconds = Number.parseInt(element.duration ?? "", 10);
    if (!Number.isFinite(seconds)) return null;

    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      distanceMeters: element.distanceMeters ?? 0,
      source: "google",
    };
  } catch {
    // Network failure, DNS, abort, malformed JSON — all degrade to manual.
    return null;
  }
}

/**
 * Should we spend a call?
 *
 * This is a paid endpoint (~$0.005), so recompute only when the answer could
 * actually have changed:
 *   (a) either address changed since the cached value was written
 *   (b) nothing has ever been computed
 *   (c) the cached value is older than ETA_STALE_HOURS
 */
export function shouldRecomputeEta(params: {
  computedAt: string | Date | null | undefined;
  cachedMinutes: number | null | undefined;
  addressesChanged: boolean;
  now?: Date;
}): boolean {
  if (params.addressesChanged) return true;
  if (params.cachedMinutes === null || params.cachedMinutes === undefined) {
    return true;
  }
  if (!params.computedAt) return true;
  const computed =
    typeof params.computedAt === "string"
      ? new Date(params.computedAt)
      : params.computedAt;
  if (Number.isNaN(computed.getTime())) return true;
  const now = params.now ?? new Date();
  const ageHours = (now.getTime() - computed.getTime()) / 3_600_000;
  return ageHours > ETA_STALE_HOURS;
}

/** True when a cached ETA is old enough to show the Refresh affordance. */
export function isEtaStale(
  computedAt: string | Date | null | undefined,
  now?: Date,
): boolean {
  if (!computedAt) return false; // nothing cached — not "stale", just absent
  const computed =
    typeof computedAt === "string" ? new Date(computedAt) : computedAt;
  if (Number.isNaN(computed.getTime())) return false;
  const ref = now ?? new Date();
  return (ref.getTime() - computed.getTime()) / 3_600_000 > ETA_STALE_HOURS;
}

/** Compose an org's shop address columns into a single query string. */
export function composeShopAddress(org: {
  shop_address_line1?: string | null;
  shop_city?: string | null;
  shop_state?: string | null;
  shop_postal_code?: string | null;
}): string {
  const region = [org.shop_city, org.shop_state].filter(Boolean).join(", ");
  const tail = [region, org.shop_postal_code].filter(Boolean).join(" ");
  return [org.shop_address_line1, tail].filter(Boolean).join(", ").trim();
}
