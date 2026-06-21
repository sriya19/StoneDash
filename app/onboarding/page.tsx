import { redirect } from "next/navigation";

import { AuthLayout } from "@/components/app/auth-layout";
import { OnboardingForm } from "@/components/app/onboarding-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertNoQueryError } from "@/lib/supabase/errors";
import type { ProfileRow } from "@/lib/supabase/types";

export const metadata = { title: "Set up your shop" };

export default async function OnboardingPage() {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/onboarding");
  }

  const profileResult = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  assertNoQueryError("onboarding:profiles.maybeSingle", profileResult.error);
  const profile = profileResult.data;

  if (profile?.active_org_id) {
    redirect("/dashboard");
  }

  const initialFullName =
    profile?.full_name ??
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "");

  return (
    <AuthLayout
      title="Set up your shop"
      subtitle="A few details so we can tailor orders, team invites, and reports."
      // Onboarding skips the marketing pull-quote (user is already
      // authenticated; quote is a conversion tool, not a setup tool).
      quote={null}
      topRight={
        <form action="/logout" method="post">
          <button
            type="submit"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      }
    >
      <OnboardingForm initialFullName={initialFullName} />
    </AuthLayout>
  );
}
