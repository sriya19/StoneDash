import { cookies } from "next/headers";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Sidebar, SIDEBAR_COLLAPSED_COOKIE } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import type { OrgSummary } from "@/components/app/org-switcher";

type MembershipRow = {
  organizations: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
  } | null;
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, email, profile, org } = await getCurrentUserAndOrg();

  const supabase = createSupabaseServerClient();
  const { data: memberships } = await supabase
    .from("org_members")
    .select("organizations(id, name, slug, logo_url)")
    .eq("user_id", userId)
    .not("invite_accepted_at", "is", null)
    .returns<MembershipRow[]>();

  const orgs: OrgSummary[] = (memberships ?? [])
    .map((row) => row.organizations)
    .filter((value): value is NonNullable<MembershipRow["organizations"]> => value !== null)
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug, logoUrl: o.logo_url }));

  // Make sure the active org is always present in the list, even if the
  // memberships query is stale for some reason.
  if (!orgs.some((o) => o.id === org.id)) {
    orgs.unshift({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logo_url,
    });
  }

  const collapsed =
    cookies().get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        initialCollapsed={collapsed}
        activeOrgId={org.id}
        orgs={orgs}
        user={{ fullName: profile.full_name, email }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
