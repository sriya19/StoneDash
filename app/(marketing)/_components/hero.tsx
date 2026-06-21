import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function MarketingHero() {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-32 sm:pt-40">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">
          Operations software for stone fabricators
        </p>
        <h1 className="mt-6 font-geist text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
          The dashboard stone shops actually use.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
          Track every order from quote to install. Manage contractor payments.
          Dispatch your crew. All in one place — built for shops, not enterprise
          software.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-1.5">
            <Link href="/signup">
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#features">See it in action</Link>
          </Button>
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          Free during open beta.
        </p>
      </div>

      {/* Product screenshot — captured from the live /dashboard via
          scripts/capture_landing_hero.ts. Re-run that script after any
          dashboard redesign to refresh the PNG. */}
      <div className="relative mx-auto mt-16 max-w-5xl px-2 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border/80 shadow-2xl shadow-brand/10">
          <Image
            src="/landing/dashboard-hero.png"
            alt="StoneDash dashboard — greeting, KPIs, pipeline, and recent activity"
            width={1280}
            height={800}
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}
