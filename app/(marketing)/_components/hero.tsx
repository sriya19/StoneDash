import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

// Centered hero. Sub-step 5 (dashboard redesign) replaces the placeholder
// screenshot div with a real PNG capture of the redesigned /dashboard.

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

      {/* Product screenshot. Sub-step 5 will swap in the captured PNG. */}
      <div className="relative mx-auto mt-16 max-w-5xl px-2 sm:px-6">
        <div
          className="aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-muted to-secondary shadow-2xl shadow-brand/10"
          aria-label="StoneDash dashboard preview"
          role="img"
        >
          {/* Placeholder gradient until sub-step 5 captures the live dashboard.
              The aspect ratio matches the eventual PNG so layout doesn't shift
              when the image lands. */}
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/60">
            <span>Dashboard preview lands in sub-step 5</span>
          </div>
        </div>
      </div>
    </section>
  );
}
