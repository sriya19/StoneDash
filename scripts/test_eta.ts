// Tests for the ETA layer. Runs under MOCK_ETA=1 — never calls Google, so
// `pnpm smoke` costs nothing (PLAN.md Q15).
//
// Split in two halves:
//   * Pure-function checks on the cache policy and staleness rules, which
//     are where the money is saved and where an off-by-one is silent.
//   * DB-backed checks on graceful degradation, using __ETA__-prefixed
//     fixtures with a per-run stamp, torn down in a finally — including
//     restoring the org's original shop address if the test mutates it.
//
// Coverage:
//   1. missing key + no mock → computeTravelTime returns null, no throw
//   2. MOCK_ETA=1 → deterministic result, stable across calls
//   3. blank origin or destination → null without a lookup
//   4. shouldRecomputeEta: nothing cached → true
//   5. shouldRecomputeEta: fresh cache → false (this is the money saver)
//   6. shouldRecomputeEta: older than ETA_STALE_HOURS → true
//   7. shouldRecomputeEta: address changed → true even when fresh
//   8. isEtaStale: absent computed_at is not "stale"
//   9. composeShopAddress: partial address composes without stray commas
//  10. DB — an order with no shop address on the org degrades cleanly

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PREFIX = "__ETA__";
const RUN_STAMP = String(Date.now());
const uniq = (label: string) => `${PREFIX}${label}_${RUN_STAMP}`;

const checks: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, actual: string) {
  checks.push([name, ok, actual]);
}

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function cleanup(sb: SupabaseClient): Promise<void> {
  await sb.from("order_events").delete().ilike("title", `${PREFIX}%`);
  await sb.from("orders").delete().ilike("project_name", `${PREFIX}%`);
  await sb.from("customers").delete().ilike("name", `${PREFIX}%`);
}

async function main() {
  // Import after the env is in place so the module reads MOCK_ETA correctly.
  const eta = await import("@/lib/eta/google-distance-matrix");
  const {
    computeTravelTime,
    shouldRecomputeEta,
    isEtaStale,
    composeShopAddress,
    ETA_STALE_HOURS,
  } = eta;

  // ---- 1. Missing key, mock off → null, never a throw -------------------
  {
    const savedMock = process.env.MOCK_ETA;
    const savedKey = process.env.GOOGLE_MAPS_SERVER_KEY;
    delete process.env.MOCK_ETA;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    let threw = false;
    let result: unknown = "unset";
    try {
      result = await computeTravelTime("123 A St, Vienna VA", "9 B Rd, Vienna VA");
    } catch {
      threw = true;
    }
    if (savedMock !== undefined) process.env.MOCK_ETA = savedMock;
    if (savedKey !== undefined) process.env.GOOGLE_MAPS_SERVER_KEY = savedKey;
    check(
      "1. missing key returns null without throwing",
      !threw && result === null,
      JSON.stringify({ threw, result }),
    );
  }

  // ---- 2. Mock mode is deterministic -----------------------------------
  {
    process.env.MOCK_ETA = "1";
    const a = await computeTravelTime("Shop, Falls Church VA", "Site, Vienna VA");
    const b = await computeTravelTime("Shop, Falls Church VA", "Site, Vienna VA");
    check(
      "2. MOCK_ETA=1 returns a stable, plausible result",
      a !== null &&
        b !== null &&
        a.minutes === b.minutes &&
        a.source === "mock" &&
        a.minutes >= 12 &&
        a.minutes <= 71 &&
        a.distanceMeters > 0,
      JSON.stringify({ a, b }),
    );
  }

  // ---- 3. Blank inputs short-circuit ------------------------------------
  {
    const none = await computeTravelTime("", "Site, Vienna VA");
    const alsoNone = await computeTravelTime("Shop", "   ");
    check(
      "3. blank origin or destination returns null",
      none === null && alsoNone === null,
      JSON.stringify({ none, alsoNone }),
    );
  }

  // ---- 4-7. Cache policy ------------------------------------------------
  const now = new Date("2026-08-25T12:00:00Z");
  const fresh = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const old = new Date(
    now.getTime() - (ETA_STALE_HOURS + 1) * 3_600_000,
  ).toISOString();

  check(
    "4. nothing cached → recompute",
    shouldRecomputeEta({
      computedAt: null,
      cachedMinutes: null,
      addressesChanged: false,
      now,
    }),
    "expected true",
  );

  check(
    "5. fresh cache → do NOT spend a call",
    shouldRecomputeEta({
      computedAt: fresh,
      cachedMinutes: 25,
      addressesChanged: false,
      now,
    }) === false,
    "expected false",
  );

  check(
    `6. older than ${ETA_STALE_HOURS}h → recompute`,
    shouldRecomputeEta({
      computedAt: old,
      cachedMinutes: 25,
      addressesChanged: false,
      now,
    }),
    "expected true",
  );

  check(
    "7. address changed → recompute even when fresh",
    shouldRecomputeEta({
      computedAt: fresh,
      cachedMinutes: 25,
      addressesChanged: true,
      now,
    }),
    "expected true",
  );

  // ---- 8. Staleness vs absence are different -----------------------------
  check(
    "8. absent computed_at is not 'stale' (nothing to refresh)",
    isEtaStale(null, now) === false && isEtaStale(old, now) === true,
    JSON.stringify({ absent: isEtaStale(null, now), old: isEtaStale(old, now) }),
  );

  // ---- 9. Address composition -------------------------------------------
  {
    const full = composeShopAddress({
      shop_address_line1: "8 Quarry Rd",
      shop_city: "Falls Church",
      shop_state: "VA",
      shop_postal_code: "22041",
    });
    const partial = composeShopAddress({
      shop_address_line1: "8 Quarry Rd",
      shop_city: null,
      shop_state: null,
      shop_postal_code: null,
    });
    const empty = composeShopAddress({
      shop_address_line1: null,
      shop_city: null,
      shop_state: null,
      shop_postal_code: null,
    });
    check(
      "9. composeShopAddress handles full, partial and empty without stray commas",
      full === "8 Quarry Rd, Falls Church, VA 22041" &&
        partial === "8 Quarry Rd" &&
        empty === "",
      JSON.stringify({ full, partial, empty }),
    );
  }

  // ---- 10. DB-backed degradation ----------------------------------------
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  const sb = admin();
  await cleanup(sb);

  const { data: org } = await sb
    .from("organizations")
    .select("id, shop_address_line1, shop_city, shop_state, shop_postal_code")
    .eq("slug", "top-marble-granite")
    .single<{
      id: string;
      shop_address_line1: string | null;
      shop_city: string | null;
      shop_state: string | null;
      shop_postal_code: string | null;
    }>();
  if (!org) throw new Error("demo org missing — run pnpm db:seed");

  const original = {
    shop_address_line1: org.shop_address_line1,
    shop_city: org.shop_city,
    shop_state: org.shop_state,
    shop_postal_code: org.shop_postal_code,
  };

  try {
    // An org with no shop address composes to "", which is what
    // refreshOrderEta checks before spending anything.
    await sb
      .from("organizations")
      .update({
        shop_address_line1: null,
        shop_city: null,
        shop_state: null,
        shop_postal_code: null,
      })
      .eq("id", org.id);

    const { data: cleared } = await sb
      .from("organizations")
      .select("shop_address_line1, shop_city, shop_state, shop_postal_code")
      .eq("id", org.id)
      .single<typeof original>();

    check(
      "10. org with no shop address composes to empty (ETA declines before spending)",
      composeShopAddress(cleared ?? {}) === "",
      JSON.stringify(cleared),
    );

    // And with one set, it composes to something routable.
    await sb
      .from("organizations")
      .update({
        shop_address_line1: uniq("8 Quarry Rd"),
        shop_city: "Falls Church",
        shop_state: "VA",
        shop_postal_code: "22041",
      })
      .eq("id", org.id);

    const { data: set } = await sb
      .from("organizations")
      .select("shop_address_line1, shop_city, shop_state, shop_postal_code")
      .eq("id", org.id)
      .single<typeof original>();

    check(
      "10b. org with a shop address composes to a routable string",
      composeShopAddress(set ?? {}).includes("Falls Church, VA 22041"),
      composeShopAddress(set ?? {}),
    );
  } finally {
    await sb.from("organizations").update(original).eq("id", org.id);
    await cleanup(sb);
  }
}

main()
  .then(() => {
    let failed = 0;
    for (const [name, ok, actual] of checks) {
      if (ok) process.stdout.write(`[OK     ] ${name}\n`);
      else {
        process.stdout.write(`[FAIL   ] ${name}\n           ${actual}\n`);
        failed += 1;
      }
    }
    process.stdout.write(
      `\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`,
    );
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`eta test FAILED: ${msg}\n`);
    process.exit(1);
  });
