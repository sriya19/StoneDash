import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

// Full-width terracotta-tinted CTA. brand-muted = #FED7AA (orange-200),
// which gives a soft warm wash without competing with the hero. The
// inner content stays in the standard max-width container.

export function CtaBand() {
  return (
    <section className="border-y border-brand-muted/60 bg-brand-muted/40 px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-geist text-3xl font-semibold tracking-tight sm:text-4xl">
          Run your shop on StoneDash.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground">
          Free during open beta. Set up takes under five minutes — bring your
          orders via CSV import and you&rsquo;re running.
        </p>
        <div className="mt-8 flex items-center justify-center">
          <Button asChild size="lg" className="gap-1.5">
            <Link href="/signup">
              Start free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
