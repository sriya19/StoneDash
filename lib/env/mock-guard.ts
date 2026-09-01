// Fail-closed guard: mock modes must never be active in a production
// runtime.
//
// Why this is a throw and not a warning. MOCK_ETA=1 short-circuits
// computeTravelTime ABOVE the real-key read, so it wins even with a valid
// GOOGLE_MAPS_SERVER_KEY configured. The fabricated 12-71 minute value is
// then PERSISTED to orders.estimated_travel_min (lib/actions/eta.ts), and
// lib/messaging/build-context.ts reads that column into the customer-facing
// install_eta template. The bad value therefore outlives the flag: removing
// the env var later does not un-write the column. A warning in a log nobody
// reads is not a control for that.
//
// Defense in depth, two layers:
//   1. instrumentation.ts calls assertNoMocksInProduction() once at server
//      startup, so a misconfigured deploy fails immediately and loudly
//      rather than at the first customer's ETA.
//   2. isMockEta() / isMockAi() call the same assertion at the point of
//      use, so a future caller cannot reopen the hole by adding a read
//      site and forgetting the startup hook.

const FLAGS = ["MOCK_AI", "MOCK_ETA"] as const;
type MockFlag = (typeof FLAGS)[number];

// Gated on VERCEL_ENV, not NODE_ENV, so preview deployments can run on
// canned data while real production cannot. Vercel builds previews with
// NODE_ENV=production too, which is why the narrower variable is the right
// discriminator.
//
//   VERCEL_ENV=production  -> guard fires
//   VERCEL_ENV=preview     -> allowed (demo a PR without burning credits)
//   VERCEL_ENV unset       -> allowed (local dev, tsx smokes, CI)
//
// KNOWN GAP, deliberate: a production deploy that is not on Vercel — a
// container on Fly/Railway/ECS, or `next start` on a VM — has no VERCEL_ENV,
// so mocks would be permitted there. That is safe today because Vercel is
// the only production target. If the app is ever hosted elsewhere, widen
// this to also treat `NODE_ENV === "production"` as production and give
// previews an explicit opt-in flag instead. Written down rather than
// guessed at, because the failure mode is silent and customer-visible.
function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function message(flags: readonly MockFlag[]): string {
  const list = flags.join(" and ");
  return (
    `${list} enabled in a production runtime. Mock mode returns fabricated ` +
    `data — a canned travel time is persisted to orders.estimated_travel_min ` +
    `and rendered into customer messages, so the bad value survives removing ` +
    `the flag. Unset ${list} in the production environment and redeploy.`
  );
}

/** Throws if any mock flag is set in a production runtime. */
export function assertNoMocksInProduction(): void {
  if (!isProductionRuntime()) return;
  const active = FLAGS.filter((flag) => process.env[flag] === "1");
  if (active.length === 0) return;
  throw new Error(message(active));
}

/** Point-of-use guard for a single flag. */
function assertMockAllowed(flag: MockFlag): void {
  if (!isProductionRuntime()) return;
  throw new Error(message([flag]));
}

/** True when the AI mock short-circuit is active. Never true in production. */
export function isMockAi(): boolean {
  if (process.env.MOCK_AI !== "1") return false;
  assertMockAllowed("MOCK_AI");
  return true;
}

/** True when the ETA mock short-circuit is active. Never true in production. */
export function isMockEta(): boolean {
  if (process.env.MOCK_ETA !== "1") return false;
  assertMockAllowed("MOCK_ETA");
  return true;
}
