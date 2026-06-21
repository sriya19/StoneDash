import Link from "next/link";
import type { OrderStage } from "@prisma/client";

import { cn } from "@/lib/utils";

export const STAGE_ORDER: OrderStage[] = [
  "quote",
  "measurement",
  "fabrication",
  "ready_for_install",
  "installation",
  "invoiced",
  "paid",
];

// Full display names — used on stage badges, order detail sheet, activity
// phrases. Shop-operator vocabulary: "Ready for Installation" rather than
// the fabrication-tool "QC".
export const STAGE_LABELS: Record<OrderStage, string> = {
  quote: "Quote",
  measurement: "Measurement",
  fabrication: "Fabrication",
  ready_for_install: "Ready for Installation",
  installation: "Install",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

// Short labels for space-constrained contexts like kanban column headers
// and the pipeline strip on the dashboard.
export const STAGE_SHORT_LABELS: Record<OrderStage, string> = {
  quote: "Quote",
  measurement: "Measurement",
  fabrication: "Fabrication",
  ready_for_install: "Ready for Install",
  installation: "Install",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

// The pipeline strip on the dashboard packs all 7 stages into a single
// row, so even "Measurement" overflows. Ultra-short labels keep every
// cell single-line; the dot color carries the disambiguation when an
// owner needs more than 3-4 characters of cue.
export const STAGE_STRIP_LABELS: Record<OrderStage, string> = {
  quote: "Quote",
  measurement: "Measure",
  fabrication: "Fab",
  ready_for_install: "Ready",
  installation: "Install",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

// Per-stage tints used on the pipeline strip. The dot color carries the
// stage's visual identity at a glance; the body of each card stays neutral
// so seven cells side-by-side don't read as a rainbow.
const STAGE_DOTS: Record<Exclude<OrderStage, "cancelled">, string> = {
  quote: "bg-zinc-400",
  measurement: "bg-amber-400",
  fabrication: "bg-brand",
  ready_for_install: "bg-blue-400",
  installation: "bg-indigo-500",
  invoiced: "bg-violet-500",
  paid: "bg-success",
};

export type StageSummary = {
  stage: OrderStage;
  count: number;
  value: number;
};

type Props = {
  currency: string;
  summaries: StageSummary[];
};

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function PipelineStrip({ currency, summaries }: Props) {
  const byStage = new Map(summaries.map((s) => [s.stage, s]));
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Pipeline</h2>
          <p className="text-xs text-muted-foreground">
            Where every active job currently lives.
          </p>
        </div>
        <Link
          href="/orders?view=board"
          className="text-xs text-brand underline-offset-4 hover:underline"
        >
          Open board →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border/70">
        {STAGE_ORDER.map((stage) => {
          const summary = byStage.get(stage) ?? { stage, count: 0, value: 0 };
          const href = `/orders?stage=${stage}`;
          const dot =
            stage === "cancelled" ? "bg-zinc-300" : STAGE_DOTS[stage];
          return (
            <Link
              key={stage}
              href={href}
              className={cn(
                "flex flex-col gap-1.5 bg-card px-3.5 py-5 transition-colors hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                {STAGE_STRIP_LABELS[stage]}
              </span>
              <span className="font-geist text-2xl font-semibold tabular-nums">
                {summary.count}
              </span>
              <span className="truncate text-[11px] text-muted-foreground tabular-nums">
                {summary.value > 0 ? formatMoney(summary.value, currency) : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
