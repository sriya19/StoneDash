import { Calendar } from "lucide-react";
import { format, parseISO, startOfDay } from "date-fns";
import type { OrderStage } from "@prisma/client";

import { cn } from "@/lib/utils";

// Stages where the install has already happened or is moot — an overdue
// date in these stages shouldn't glow red.
const POST_INSTALL_STAGES: ReadonlySet<OrderStage> = new Set([
  "installation",
  "invoiced",
  "paid",
  "cancelled",
]);

type Props = {
  value: string | null;
  stage: OrderStage;
  size?: "sm" | "md";
  className?: string;
};

export function InstallDate({ value, stage, size = "sm", className }: Props) {
  if (!value) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-muted-foreground/70",
          size === "md" ? "text-sm" : "text-xs",
          className,
        )}
      >
        <Calendar
          className={cn("shrink-0", size === "md" ? "h-3.5 w-3.5" : "h-3 w-3")}
        />
        <span>— not scheduled</span>
      </span>
    );
  }

  let parsed: Date;
  try {
    parsed = parseISO(value);
  } catch {
    return (
      <span className={cn("text-muted-foreground", className)}>{value}</span>
    );
  }

  const today = startOfDay(new Date());
  const target = startOfDay(parsed);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const isPostInstall = POST_INSTALL_STAGES.has(stage);

  let tone: string;
  let weight: string;
  if (diffDays === 0) {
    tone = "text-brand";
    weight = "font-bold";
  } else if (diffDays < 0 && !isPostInstall) {
    tone = "text-destructive";
    weight = "font-bold";
  } else if (diffDays > 0 && diffDays <= 7) {
    tone = "text-foreground";
    weight = "font-semibold";
  } else {
    tone = "text-muted-foreground";
    weight = "font-normal";
  }

  const sameYear = parsed.getFullYear() === today.getFullYear();
  const label = sameYear
    ? format(parsed, "EEE, MMM d")
    : format(parsed, "EEE, MMM d, yyyy");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        size === "md" ? "text-sm" : "text-xs",
        tone,
        weight,
        className,
      )}
    >
      <Calendar
        className={cn("shrink-0", size === "md" ? "h-3.5 w-3.5" : "h-3 w-3")}
      />
      <span>{label}</span>
    </span>
  );
}
