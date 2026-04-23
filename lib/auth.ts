import "server-only";

import { redirect } from "next/navigation";
import type { MemberRole } from "@prisma/client";

import { createSupabaseServerClient } from "./supabase/server";
import { assertNoQueryError } from "./supabase/errors";
import type { OrganizationRow, ProfileRow } from "./supabase/types";

export type AuthContext = {
  userId: string;
  email: string;
  profile: ProfileRow;
  org: OrganizationRow;
  role: MemberRole;
};

// getCurrentUserAndOrg — canonical accessor for Server Components and Server
// Actions inside the (app) route group. Redirects:
//   * /login      — no authenticated user
//   * /onboarding — authenticated but no active org / no membership
// Returns a fully-typed AuthContext when all three are satisfied.
export async function getCurrentUserAndOrg(): Promise<AuthContext> {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  assertNoQueryError("profiles.maybeSingle", profileResult.error);
  const profile = profileResult.data;

  if (!profile || !profile.active_org_id) {
    redirect("/onboarding");
  }

  const orgResult = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.active_org_id)
    .maybeSingle<OrganizationRow>();
  assertNoQueryError("organizations.maybeSingle", orgResult.error);
  const org = orgResult.data;

  if (!org) {
    redirect("/onboarding");
  }

  const memberResult = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .not("invite_accepted_at", "is", null)
    .maybeSingle<{ role: MemberRole }>();
  assertNoQueryError("org_members.maybeSingle", memberResult.error);
  const member = memberResult.data;

  if (!member) {
    redirect("/onboarding");
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    org,
    role: member.role,
  };
}

// Lightweight accessor: returns just the auth user, or null. Use in places
// where the full profile/org lookup isn't necessary (e.g. the /login page
// redirecting an already-signed-in user).
export async function getCurrentUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
