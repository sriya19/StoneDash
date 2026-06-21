import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

export type KpiTrend = {
  delta: number; // signed percent, e.g. 12 or -8
  label: string; // e.g. "from last week"
};

type Props = {
  label: string;
  value: string;
  sublabel?: string | null;
  icon: LucideIcon;
  href?: string;
  trend?: KpiTrend | null;
  // "urgent" tints the card with a soft terracotta wash — reserved for
  // KPIs that demand attention today (installs happening now, overdue
  // balances). Used sparingly so the accent keeps its meaning.
  urgent?: boolean;
  className?: string;
};

export function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  href,
  trend,
  urgent,
  className,
}: Props) {
  const content = (
    <div
      className={cn(
        "group relative flex h-full flex-col justify-between rounded-xl border bg-card p-5 transition-colors",
        href && "hover:border-foreground/20",
        urgent && "border-brand/40 bg-brand-muted/30 hover:border-brand/60",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-xs font-medium uppercase tracking-wider",
            urgent ? "text-brand" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <Icon
          className={cn(
            "h-4 w-4",
            urgent ? "text-brand" : "text-muted-foreground",
          )}
        />
      </div>
      <div className="mt-5 space-y-1.5">
        <div className="font-geist text-[32px] font-semibold leading-none tracking-tight tabular-nums">
          {value}
        </div>
        {sublabel ? (
          <p className="truncate text-xs text-muted-foreground">{sublabel}</p>
        ) : null}
        {trend ? <TrendBadge trend={trend} /> : null}
      </div>
      {href ? (
        <ArrowUpRight className="absolute right-4 top-4 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

function TrendBadge({ trend }: { trend: KpiTrend }) {
  if (trend.delta === 0) {
    return (
      <span className="inline-flex items-center text-[11px] text-muted-foreground tabular-nums">
        flat {trend.label}
      </span>
    );
  }
  const up = trend.delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums",
        up ? "text-success" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(trend.delta)}% {trend.label}
    </span>
  );
}
