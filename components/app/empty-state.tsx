import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  // Render-prop for an optional CTA (e.g. a <Button> linking to "+ Add").
  // Kept as a node rather than a `{label, href}` so callers can wire
  // either a Link button or a dialog trigger without this component
  // needing to know which.
  action?: React.ReactNode;
  // "default" — full-bleed empty for first-touch surfaces (no rows yet,
  // user has never created one). Bigger padding, optional icon.
  // "inline" — compact empty for filter-mismatch states ("No X match
  // the current filter"). Sits inside an already-bordered shell, so it
  // skips the outer ring + tightens padding.
  variant?: "default" | "inline";
  className?: string;
};

// One shared empty-state shell so every list surface reads the same.
// Without this, `orders-table`, `customers-table`, `contractors-table`,
// `crew-table`, `calendar-list`, `contractor-jobs-tab` each had their
// own slightly-different rounded-xl/border/padding/text-sm copy block —
// drift was already visible (p-12 vs p-8, different muted treatments).
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: Props) {
  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 px-6 py-10 text-center",
          className,
        )}
      >
        {Icon ? (
          <Icon className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
        ) : null}
        <p className="text-sm text-muted-foreground">{title}</p>
        {description ? (
          <p className="text-xs text-muted-foreground/80">{description}</p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border bg-card px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <div
          className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted/40 text-brand"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
