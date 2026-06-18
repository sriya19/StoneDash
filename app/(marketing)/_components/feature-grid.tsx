import {
  CalendarDays,
  FileText,
  HardHat,
  KanbanSquare,
  Lock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
};

const FEATURES: Feature[] = [
  {
    icon: KanbanSquare,
    title: "Track every order through every stage",
    blurb:
      "Quote → measurement → fabrication → install → paid. Drag to update stages, see the whole pipeline at a glance.",
  },
  {
    icon: HardHat,
    title: "Know what every contractor owes you",
    blurb:
      "Tag jobs to contractors, log payments, split one check across multiple kitchens. Ledger updates instantly.",
  },
  {
    icon: CalendarDays,
    title: "Schedule your crew from one calendar",
    blurb:
      "Measurements, installs, deliveries — all on one calendar, with one-tap share links the crew can open on their phone.",
  },
  {
    icon: FileText,
    title: "Stop chasing paper and screenshots",
    blurb:
      "Slab photos, contracts, invoices — all attached to the order, all in one place. No more digging through WhatsApp threads.",
  },
  {
    icon: Sparkles,
    title: "Built for shops, not enterprise",
    blurb:
      "Fast, focused UI that respects your time. No bloated workflows, no per-seat pricing nonsense.",
  },
  {
    icon: Lock,
    title: "Yours alone — multi-tenant from day one",
    blurb:
      "Row-level security on every query. Your shop's data is invisible to every other shop on the platform.",
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="border-t border-border/60 bg-background px-6 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">
            What it does
          </p>
          <h2 className="mt-4 font-geist text-3xl font-semibold tracking-tight sm:text-4xl">
            One tool for everything that runs your shop.
          </h2>
        </div>
        <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <FeatureTile key={f.title} feature={f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureTile({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="flex flex-col">
      <span
        aria-hidden
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-muted/60 text-brand"
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-geist text-lg font-semibold tracking-tight">
        {feature.title}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{feature.blurb}</p>
    </div>
  );
}
