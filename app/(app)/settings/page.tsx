import { redirect } from "next/navigation";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditOrganization, canManageMembers } from "@/lib/rbac";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsProfileForm } from "@/components/app/settings-profile-form";
import { SettingsShopForm } from "@/components/app/settings-shop-form";
import {
  SettingsMembers,
  type MemberListRow,
} from "@/components/app/settings-members";

type SearchParams = { tab?: string };
type MemberRow = {
  id: string;
  user_id: string | null;
  role: MemberListRow["role"];
  invited_email: string | null;
  invite_token: string | null;
  invite_accepted_at: string | null;
  created_at: string;
};
type ProfileLookup = { id: string; full_name: string | null };

export const metadata = { title: "Settings · Stone & Design Board" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { userId, email, profile, org, role } = await getCurrentUserAndOrg();

  const canShop = canEditOrganization(role);
  const canMembers = canManageMembers(role);

  let members: MemberListRow[] = [];
  if (canMembers) {
    const supabase = createSupabaseServerClient();
    const { data: rows } = await supabase
      .from("org_members")
      .select(
        "id, user_id, role, invited_email, invite_token, invite_accepted_at, created_at",
      )
      .eq("org_id", org.id)
      .order("created_at", { ascending: true })
      .returns<MemberRow[]>();

    // Look up display names + emails for accepted members via the admin
    // client (RLS blocks reading auth.users, and profiles is self-only).
    const userIds = Array.from(
      new Set((rows ?? []).map((r) => r.user_id).filter((id): id is string => Boolean(id))),
    );

    let profilesById = new Map<string, string | null>();
    let emailsById = new Map<string, string | null>();
    if (userIds.length > 0) {
      const admin = createSupabaseAdminClient();
      const [profRes, authRes] = await Promise.all([
        admin
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds)
          .returns<ProfileLookup[]>(),
        admin.auth.admin.listUsers({ perPage: 200 }),
      ]);
      profilesById = new Map((profRes.data ?? []).map((p) => [p.id, p.full_name]));
      emailsById = new Map(
        (authRes.data?.users ?? [])
          .filter((u) => userIds.includes(u.id))
          .map((u) => [u.id, u.email ?? null]),
      );
    }

    members = (rows ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      role: row.role,
      invited_email: row.invited_email,
      invite_token: row.invite_token,
      invite_accepted_at: row.invite_accepted_at,
      created_at: row.created_at,
      fullName: row.user_id ? profilesById.get(row.user_id) ?? null : null,
      authEmail: row.user_id ? emailsById.get(row.user_id) ?? null : null,
    }));
  }

  const tab = searchParams.tab === "shop" || searchParams.tab === "members"
    ? searchParams.tab
    : "profile";

  if (tab === "shop" && !canShop) redirect("/settings?tab=profile");
  if (tab === "members" && !canMembers) redirect("/settings?tab=profile");

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {canShop ? <TabsTrigger value="shop">Shop</TabsTrigger> : null}
          {canMembers ? <TabsTrigger value="members">Members</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="profile">
          <SettingsProfileForm
            email={email}
            initial={{
              fullName: profile.full_name ?? "",
              phone: profile.phone ?? "",
              theme: (profile.theme === "dark" || profile.theme === "system"
                ? profile.theme
                : "light"),
            }}
          />
        </TabsContent>

        {canShop ? (
          <TabsContent value="shop">
            <SettingsShopForm
              initial={{
                name: org.name,
                slug: org.slug,
                timezone: org.timezone,
                currency: org.currency,
                orderPrefix: org.order_prefix,
                orderSeqStart: org.order_seq_start,
              }}
            />
          </TabsContent>
        ) : null}

        {canMembers ? (
          <TabsContent value="members">
            <SettingsMembers
              members={members}
              currentUserId={userId}
              siteUrl={siteUrl}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
