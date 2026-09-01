// Next.js server-startup hook. Runs once per server process, before any
// request is handled.
//
// Requires `experimental.instrumentationHook: true` in next.config.mjs on
// Next 14 (the flag became unnecessary in 15).
//
// The only job here is to refuse to boot with mock data enabled in
// production — see lib/env/mock-guard.ts for why that is a throw. Keep this
// file dependency-light: it runs in both the nodejs and edge runtimes, so
// anything imported here must be safe in both.
export async function register(): Promise<void> {
  const { assertNoMocksInProduction } = await import("./lib/env/mock-guard");
  assertNoMocksInProduction();
}
