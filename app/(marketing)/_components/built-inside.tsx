import Link from "next/link";

export function BuiltInside() {
  return (
    <section className="border-t border-border/60 bg-background px-6 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_320px] lg:items-start">
        {/* Left: shop story */}
        <div className="max-w-2xl space-y-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">
            Built inside a shop
          </p>
          <h2 className="font-geist text-3xl font-semibold tracking-tight sm:text-4xl">
            Every screen traces back to a real moment of pain on a real shop
            floor.
          </h2>
          <div className="space-y-4 text-pretty text-base text-muted-foreground">
            <p>
              StoneDash was built inside Top Marble &amp; Granite, a fabrication
              shop in Virginia. The features exist because we hit the friction
              ourselves.
            </p>
            <p>
              We track every install because we missed install dates. We built
              the contractor ledger because we couldn&rsquo;t answer
              &ldquo;what does Ameer owe us&rdquo; fast enough. We added the
              schedule because crew dispatch was happening in three different
              WhatsApp threads.
            </p>
            <p>
              When a tool is built by the people who use it every day, you can
              feel the difference. No vague abstractions. No imaginary
              workflows. Every button does something the shop actually needs.
            </p>
          </div>
        </div>

        {/* Right: author card */}
        <aside className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm lg:sticky lg:top-24">
          <div className="flex items-center gap-4">
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted font-geist text-lg font-semibold text-muted-foreground"
            >
              SP
            </div>
            <div className="min-w-0">
              <p className="font-geist text-base font-semibold tracking-tight">
                Sriya Pothula
              </p>
              <p className="text-xs text-muted-foreground">
                Founder &amp; engineer
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Building StoneDash from inside the shop. Software for the
            fabrication trades.
          </p>
          <Link
            href="#"
            className="mt-4 inline-flex items-center text-xs font-medium text-brand hover:text-brand-hover"
            aria-label="Sriya Pothula on LinkedIn"
          >
            LinkedIn →
          </Link>
        </aside>
      </div>
    </section>
  );
}
