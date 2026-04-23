import { redirect } from "next/navigation";
import Link from "next/link";

import { OnboardingForm } from "@/components/app/onboarding-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertNoQueryError } from "@/lib/supabase/errors";
import type { ProfileRow } from "@/lib/supabase/types";

export const metadata = { title: "Set up your shop · Stone & Design Board" };

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
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Stone &amp; Design Board
        </Link>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-6 rounded-xl border bg-background p-8 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Set up your shop</h1>
            <p className="text-sm text-muted-foreground">
              A few details so we can tailor orders, team invites, and reports.
            </p>
          </div>
          <OnboardingForm initialFullName={initialFullName} />
        </div>
      </main>
    </div>
  );
}
