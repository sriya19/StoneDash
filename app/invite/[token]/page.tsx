import Link from "next/link";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AcceptInviteCard } from "@/components/app/accept-invite-card";

type InviteLookup = {
  id: string;
  role: string;
  invite_accepted_at: string | null;
  organizations: { id: string; name: string } | null;
};

export const metadata = { title: "Accept invite · Stone & Design Board" };

export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Look up the invite via the admin client — RLS would otherwise hide rows
  // for orgs the caller isn't a member of yet.
  const admin = createSupabaseAdminClient();
  const { data: invite } = await admin
    .from("org_members")
    .select("id, role, invite_accepted_at, organizations(id, name)")
    .eq("invite_token", params.token)
    .maybeSingle<InviteLookup>();

  const missing = !invite;
  const alreadyUsed = Boolean(invite?.invite_accepted_at);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Stone &amp; Design Board
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-4 rounded-xl border bg-background p-8 shadow-sm">
          {missing ? (
            <div className="space-y-2 text-center">
              <h1 className="text-lg font-semibold">Invite not found</h1>
              <p className="text-sm text-muted-foreground">
                This invite link may have been revoked or already used.
              </p>
              <Link
                href="/"
                className="inline-block text-xs underline underline-offset-4 text-muted-foreground"
              >
                Back to home
              </Link>
            </div>
          ) : alreadyUsed ? (
            <div className="space-y-2 text-center">
              <h1 className="text-lg font-semibold">Invite already used</h1>
              <p className="text-sm text-muted-foreground">
                This invite has been accepted. Sign in to continue.
              </p>
              <Link
                href="/login"
                className="inline-block text-xs underline underline-offset-4"
              >
                Go to login
              </Link>
            </div>
          ) : !user ? (
            <div className="space-y-2 text-center">
              <h1 className="text-lg font-semibold">You&apos;re invited</h1>
              <p className="text-sm text-muted-foreground">
                Sign in or sign up to join <strong>{invite.organizations?.name ?? "this shop"}</strong> as {invite.role}.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <Link
                  href={`/login?next=/invite/${params.token}`}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  Log in
                </Link>
                <Link
                  href={`/signup`}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                >
                  Create account
                </Link>
              </div>
            </div>
          ) : (
            <AcceptInviteCard
              token={params.token}
              orgName={invite.organizations?.name ?? "this shop"}
              role={invite.role}
              email={user.email ?? ""}
            />
          )}
        </div>
      </main>
    </div>
  );
}
