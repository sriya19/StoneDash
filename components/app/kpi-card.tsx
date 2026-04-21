import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  sublabel?: string | null;
  icon: LucideIcon;
  href?: string;
  className?: string;
};

export function KpiCard({ label, value, sublabel, icon: Icon, href, className }: Props) {
  const content = (
    <div
      className={cn(
        "group relative flex h-full flex-col justify-between rounded-xl border bg-card p-5 transition-colors",
        href && "hover:border-foreground/20",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-4 space-y-1">
        <div className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        {sublabel ? (
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        ) : null}
      </div>
      {href ? (
        <ArrowUpRight className="absolute right-4 top-4 h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
