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
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Pipeline</h2>
        <Link
          href="/orders?view=board"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Open board
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {STAGE_ORDER.map((stage) => {
          const summary = byStage.get(stage) ?? { stage, count: 0, value: 0 };
          const href = `/orders?stage=${stage}`;
          return (
            <Link
              key={stage}
              href={href}
              className={cn(
                "flex flex-col gap-1 bg-card px-3 py-4 transition-colors hover:bg-muted/50",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {STAGE_SHORT_LABELS[stage]}
              </span>
              <span className="text-xl font-semibold tabular-nums">
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
