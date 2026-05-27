// In-memory IP-based rate limiter for /j/[slug] (Task 3 Q2).
//
// 30 requests per IP per minute. In a single-instance dev/start server the
// bucket is shared across all requests; on a Vercel deployment each warm
// function instance maintains its own bucket, so the *effective* limit is
// somewhere between 30/min and N × 30/min for N warm instances. Good enough
// to defeat naive enumeration; a proper distributed limiter
// (@upstash/ratelimit etc.) is a Task 4+ infra concern.
//
// Lazy cleanup: when the bucket count exceeds 10k entries we sweep expired
// rows. Without this, a high-volume bot would balloon memory until the
// instance is recycled.

const LIMIT_PER_MIN = 30;
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function checkIpRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    sweepIfNeeded(now);
    return { ok: true, remaining: LIMIT_PER_MIN - 1, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > LIMIT_PER_MIN) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return {
    ok: true,
    remaining: Math.max(0, LIMIT_PER_MIN - bucket.count),
    retryAfterSec: 0,
  };
}

function sweepIfNeeded(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}

// Test-only: lets the smoke / integration scripts reset between runs.
export function _resetForTests(): void {
  buckets.clear();
}
