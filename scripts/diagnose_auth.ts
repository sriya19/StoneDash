// Reusable auth / RLS diagnostic. When someone reports "I can log in but
// see nothing" or an /onboarding <-> /dashboard loop, run this with their
// credentials to see what the RLS-scoped session actually sees.
//
// Usage:
//   DIAGNOSE_EMAIL=owner@topmarble.local \
//   DIAGNOSE_PASSWORD='StoneDemo!2026' \
//   pnpm tsx --env-file=.env.local scripts/diagnose_auth.ts
//
// Runs the same three queries getCurrentUserAndOrg runs, each with the
// user's JWT attached. Any PostgREST error surfaces here — where it would
// otherwise be swallowed by .maybeSingle() and produce an empty result.

import { createClient, type PostgrestError } from "@supabase/supabase-js";

type QueryReport = {
  name: string;
  error: PostgrestError | null;
  data: unknown;
};

function report(r: QueryReport) {
  process.stdout.write(`  ${r.name}\n`);
  process.stdout.write(
    `    error = ${r.error ? `${r.error.code ?? "?"} ${r.error.message}` : "(none)"}\n`,
  );
  process.stdout.write(`    data  = ${JSON.stringify(r.data)}\n`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.DIAGNOSE_EMAIL;
  const password = process.env.DIAGNOSE_PASSWORD;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!email) missing.push("DIAGNOSE_EMAIL");
  if (!password) missing.push("DIAGNOSE_PASSWORD");
  if (missing.length > 0) {
    process.stderr.write(
      `Missing required env: ${missing.join(", ")}\n` +
        `Example: DIAGNOSE_EMAIL=user@example.com DIAGNOSE_PASSWORD=... \\\n` +
        `  pnpm tsx --env-file=.env.local scripts/diagnose_auth.ts\n`,
    );
    process.exit(2);
  }

  const client = createClient(url!, anon!);
  const { data: signin, error: signinError } =
    await client.auth.signInWithPassword({ email: email!, password: password! });

  if (signinError || !signin.user) {
    process.stderr.write(
      `Sign-in failed: ${signinError?.message ?? "no user returned"}\n`,
    );
    process.exit(1);
  }
  const userId = signin.user.id;
  process.stdout.write(`Signed in as ${signin.user.email} (uid=${userId})\n\n`);

  // Step 1 — profiles
  process.stdout.write("profiles — drives the /onboarding decision\n");
  const profRes = await client
    .from("profiles")
    .select("id, active_org_id, full_name, theme")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      active_org_id: string | null;
      full_name: string | null;
      theme: string;
    }>();
  report({ name: "profiles.maybeSingle", error: profRes.error, data: profRes.data });

  const activeOrg = profRes.data?.active_org_id;
  if (!activeOrg) {
    process.stdout.write(
      "\nNo active_org_id. User would be sent to /onboarding. Stopping.\n",
    );
    await client.auth.signOut();
    return;
  }

  // Step 2 — organizations
  process.stdout.write("\norganizations — if this errors, /dashboard loops\n");
  const orgRes = await client
    .from("organizations")
    .select("id, name, slug")
    .eq("id", activeOrg)
    .maybeSingle<{ id: string; name: string; slug: string }>();
  report({ name: "organizations.maybeSingle", error: orgRes.error, data: orgRes.data });

  // Step 3 — org_members (the historical trap)
  process.stdout.write("\norg_members — the historical RLS trap\n");
  const memRes = await client
    .from("org_members")
    .select("id, role, invite_accepted_at")
    .eq("org_id", activeOrg)
    .eq("user_id", userId)
    .not("invite_accepted_at", "is", null)
    .maybeSingle<{ id: string; role: string; invite_accepted_at: string | null }>();
  report({ name: "org_members.maybeSingle", error: memRes.error, data: memRes.data });

  const allGreen =
    !profRes.error && !orgRes.error && !memRes.error && memRes.data !== null;
  process.stdout.write(
    `\nVerdict: ${allGreen ? "all three succeed — /dashboard should render" : "at least one step fails or returns null — that's where the gate breaks"}\n`,
  );

  await client.auth.signOut();
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
