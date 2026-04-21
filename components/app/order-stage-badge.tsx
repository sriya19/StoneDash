import type { OrderStage } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGE_LABELS } from "./pipeline-strip";

const STAGE_STYLES: Record<OrderStage, string> = {
  quote: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  measurement: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  fabrication: "bg-brand/15 text-brand dark:text-brand-foreground",
  qc: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  installation: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  invoiced: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  cancelled: "bg-muted text-muted-foreground",
};

type Props = {
  stage: OrderStage;
  className?: string;
};

export function OrderStageBadge({ stage, className }: Props) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-transparent shadow-none hover:bg-current/20",
        STAGE_STYLES[stage],
        className,
      )}
    >
      {STAGE_LABELS[stage]}
    </Badge>
  );
}
