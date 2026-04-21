"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const PRETTY: Record<string, string> = {
  dashboard: "Dashboard",
  orders: "Orders",
  customers: "Customers",
  settings: "Settings",
  inventory: "Inventory",
  schedule: "Schedule",
  invoices: "Invoices",
  team: "Team",
};

function humanize(segment: string): string {
  return PRETTY[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {segments.map((seg, idx) => {
        const href = "/" + segments.slice(0, idx + 1).join("/");
        const isLast = idx === segments.length - 1;
        return (
          <Fragment key={href}>
            {idx > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            ) : null}
            {isLast ? (
              <span className="font-medium">{humanize(seg)}</span>
            ) : (
              <Link href={href} className="text-muted-foreground hover:text-foreground">
                {humanize(seg)}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
