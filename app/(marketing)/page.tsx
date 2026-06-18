import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { MarketingNav } from "./_components/nav";
import { MarketingHero } from "./_components/hero";
import { FeatureGrid } from "./_components/feature-grid";
import { BuiltInside } from "./_components/built-inside";
import { CtaBand } from "./_components/cta-band";
import { MarketingFooter } from "./_components/footer";

// Page-specific metadata — the root layout sets the
// { default, template } title shape; on the marketing landing we want a
// title that doesn't carry the "· StoneDash" suffix (the wordmark is
// already StoneDash and the suffix reads as duplication on the homepage).
export const metadata: Metadata = {
  title: { absolute: "StoneDash — The dashboard stone shops actually use." },
  description:
    "Track every order from quote to install. Manage contractor payments. Dispatch your crew. All in one place — built for shops, not enterprise software.",
  openGraph: {
    title: "StoneDash — The dashboard stone shops actually use.",
    description:
      "Operations software for stone, marble, granite, and quartz fabrication shops.",
    type: "website",
  },
};

export default async function MarketingHome() {
  // Logged-in visitors get bounced straight to the app. getCurrentUser is
  // a lightweight accessor that returns null when there's no session —
  // it doesn't redirect on its own, which is exactly what we want here
  // (the marketing page must render for everyone else).
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <MarketingNav />
      <main className="overflow-x-hidden">
        <MarketingHero />
        <FeatureGrid />
        <BuiltInside />
        <CtaBand />
      </main>
      <MarketingFooter />
    </>
  );
}
