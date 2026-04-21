import { formatDistanceToNow } from "date-fns";
import { FileText, Package, User, Wrench } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export type ActivityRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  entityType: string;
  action: string;
  metadata: Record<string, unknown>;
};

type Props = {
  items: ActivityRow[];
};

function iconFor(entityType: string) {
  switch (entityType) {
    case "order":
      return Wrench;
    case "customer":
      return User;
    case "attachment":
      return FileText;
    default:
      return Package;
  }
}

function phraseFor(row: ActivityRow): string {
  const who = row.actorName ?? "Someone";
  const m = row.metadata;
  const orderNumber = typeof m.order_number === "string" ? m.order_number : null;
  const name = typeof m.name === "string" ? m.name : null;

  switch (`${row.entityType}:${row.action}`) {
    case "order:created":
      return `${who} created ${orderNumber ?? "an order"}`;
    case "order:stage_changed": {
      const from = typeof m.from === "string" ? m.from : "";
      const to = typeof m.to === "string" ? m.to : "";
      return `${who} moved ${orderNumber ?? "an order"} from ${from} → ${to}`;
    }
    case "order:updated":
      return `${who} updated ${orderNumber ?? "an order"}`;
    case "order:deleted":
      return `${who} deleted ${orderNumber ?? "an order"}`;
    case "customer:created":
      return `${who} added customer ${name ?? ""}`.trim();
    case "customer:updated":
      return `${who} updated customer ${name ?? ""}`.trim();
    case "customer:deleted":
      return `${who} removed customer ${name ?? ""}`.trim();
    case "attachment:uploaded": {
      const filename = typeof m.original_name === "string" ? m.original_name : "a file";
      return `${who} uploaded ${filename}`;
    }
    case "attachment:deleted":
      return `${who} deleted an attachment`;
    default:
      return `${who} ${row.action.replace(/_/g, " ")} ${row.entityType}`;
  }
}

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ?? "").join("").toUpperCase() || "—";
}

export function ActivityFeed({ items }: Props) {
  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <span className="text-xs text-muted-foreground">Latest 15</span>
      </div>
      <ol className="flex-1 divide-y">
        {items.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Create an order to get started.
          </li>
        ) : (
          items.map((item) => {
            const Icon = iconFor(item.entityType);
            return (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <Avatar className="mt-0.5 h-6 w-6">
                  <AvatarFallback className="text-[10px]">
                    {initials(item.actorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm leading-snug">{phraseFor(item)}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    <time dateTime={item.createdAt}>
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </time>
                  </p>
                </div>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
