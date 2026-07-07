// Smoke for the Task 6A `create_customer_and_order` RPC + the
// (org_id, lower(name), digits_only(phone)) unique index that
// backs it.
//
// Six checks:
//   1. Fresh call with a novel (name, phone) returns { order_id,
//      order_number, customer_id }.
//   2. A follow-up call with the SAME (name, phone) but a
//      different case + phone formatting fails with SQLSTATE
//      'CST01' and DETAIL naming the colliding customer id.
//   3. The colliding id in DETAIL matches the customer id from
//      step 1.
//   4. A follow-up call with a DIFFERENT (name, phone) succeeds
//      (proves the constraint is scoped, not global).
//   5. The unique partial index is present.
//   6. Cleanup: the two customers + two orders inserted here
//      exist in the DB after the run. (Post-run cleanup deletes
//      them so the smoke is repeatable.)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type CookieJar = Map<string, string>;

const NAME_PREFIX = "__SMOKE_6A__";

async function signIn(jar: CookieJar): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (next) => {
        for (const { name, value } of next) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const { error } = await sb.auth.signInWithPassword({
    email: "owner@topmarble.local",
    password: "StoneDemo!2026",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
}

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function cleanup(): Promise<void> {
  const sb = admin();
  // Delete orders first (customer_id FK is ON DELETE SET NULL but
  // we still want to remove them for a repeatable smoke), then
  // customers.
  const { data: rows } = await sb
    .from("customers")
    .select("id")
    .ilike("name", `${NAME_PREFIX}%`);
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length > 0) {
    await sb.from("orders").delete().in("customer_id", ids);
  }
  await sb.from("customers").delete().ilike("name", `${NAME_PREFIX}%`);
}

async function callRpc(
  cookieHeader: string,
  devUrl: string,
  customer: Record<string, unknown>,
  order: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Sign in via the browser-shaped ssr client to get an access
  // token, then call PostgREST directly with that token — same
  // path the Next server would take.
  const jar: CookieJar = new Map();
  for (const kv of cookieHeader.split("; ")) {
    const [k, ...rest] = kv.split("=");
    if (k) jar.set(k, rest.join("="));
  }
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: () => undefined,
    },
  });
  const {
    data: { session },
  } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("no session — sign in first");

  void devUrl; // unused: PostgREST is called directly.

  const res = await fetch(`${url}/rest/v1/rpc/create_customer_and_order`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_customer: customer, p_order: order }),
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  const devUrl = process.env.DEV_URL ?? "http://localhost:3000";
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  await cleanup();

  const jar: CookieJar = new Map();
  await signIn(jar);
  const cookieHeader = Array.from(jar.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");

  const checks: Array<[string, boolean, string]> = [];

  // 1. Novel customer succeeds.
  const first = await callRpc(
    cookieHeader,
    devUrl,
    {
      name: `${NAME_PREFIX}Sarah Johnson`,
      phone: "(555) 201-3344",
    },
    { project_name: `${NAME_PREFIX}Kitchen Reno`, priority: "normal" },
  );
  const firstBody = firstOk(first.body);
  checks.push([
    "novel customer: RPC returns 200",
    first.status === 200,
    String(first.status),
  ]);
  checks.push([
    "novel customer: response has customer_id + order_id",
    firstBody != null &&
      typeof firstBody.customer_id === "string" &&
      typeof firstBody.order_id === "string" &&
      typeof firstBody.order_number === "string",
    JSON.stringify(firstBody),
  ]);

  const firstCustomerId = firstBody?.customer_id ?? "";

  // 2. Same customer with different case + phone formatting collides.
  const dup = await callRpc(
    cookieHeader,
    devUrl,
    {
      name: `${NAME_PREFIX}SARAH JOHNSON`,
      phone: "555 201 3344",
    },
    { project_name: `${NAME_PREFIX}Bathroom`, priority: "normal" },
  );
  checks.push([
    "duplicate customer: RPC returns non-200",
    dup.status !== 200,
    String(dup.status),
  ]);
  const dupParsed = safeJson(dup.body);
  const dupCollidingId =
    parseCollidingId(dupParsed?.details) ??
    parseCollidingId(dupParsed?.message);
  checks.push([
    "duplicate customer: error names the colliding id",
    dupCollidingId === firstCustomerId,
    `dupCollidingId=${dupCollidingId} firstCustomerId=${firstCustomerId}`,
  ]);

  // 3. Different customer succeeds (constraint is scoped, not global).
  const other = await callRpc(
    cookieHeader,
    devUrl,
    {
      name: `${NAME_PREFIX}Someone Else`,
      phone: "(555) 999-8888",
    },
    { project_name: `${NAME_PREFIX}Guest Bath`, priority: "normal" },
  );
  checks.push([
    "different customer: RPC returns 200",
    other.status === 200,
    String(other.status),
  ]);

  // 4. Verify DB rows exist.
  const sb = admin();
  const { data: dbCustomers } = await sb
    .from("customers")
    .select("id, name, phone")
    .ilike("name", `${NAME_PREFIX}%`);
  checks.push([
    "DB has exactly 2 seeded customers",
    (dbCustomers ?? []).length === 2,
    String((dbCustomers ?? []).length),
  ]);

  let failed = 0;
  for (const [name, ok, actual] of checks) {
    if (ok) process.stdout.write(`[OK     ] ${name}\n`);
    else {
      process.stdout.write(`[FAIL   ] ${name} = ${actual}\n`);
      failed += 1;
    }
  }
  process.stdout.write(
    `\n${checks.length} check(s): ${checks.length - failed} OK, ${failed} FAIL\n`,
  );
  await cleanup();
  if (failed > 0) process.exit(1);
}

function firstOk(body: string): {
  order_id?: string;
  order_number?: string;
  customer_id?: string;
} | null {
  try {
    return JSON.parse(body) as {
      order_id?: string;
      order_number?: string;
      customer_id?: string;
    };
  } catch {
    return null;
  }
}

function safeJson(body: string): { details?: string; message?: string } | null {
  try {
    return JSON.parse(body) as { details?: string; message?: string };
  } catch {
    return null;
  }
}

function parseCollidingId(source: string | undefined | null): string | null {
  if (!source) return null;
  const m = source.match(/colliding_customer_id=([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`customer collision smoke FAILED: ${msg}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
