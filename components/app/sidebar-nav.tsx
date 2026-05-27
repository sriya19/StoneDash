"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  HardHat,
  Home,
  Package,
  Receipt,
  Settings,
  Users,
  Users2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type NavEntry =
  | { kind: "active"; label: string; href: string; icon: LucideIcon }
  | { kind: "coming_soon"; label: string; icon: LucideIcon };

export const SIDEBAR_NAV: NavEntry[] = [
  { kind: "active", label: "Dashboard", href: "/dashboard", icon: Home },
  { kind: "active", label: "Orders", href: "/orders", icon: Wrench },
  { kind: "active", label: "Customers", href: "/customers", icon: Users },
  { kind: "active", label: "Contractors", href: "/contractors", icon: HardHat },
  { kind: "active", label: "Team", href: "/team", icon: Users2 },
  { kind: "coming_soon", label: "Inventory", icon: Package },
  { kind: "coming_soon", label: "Schedule", icon: CalendarDays },
  { kind: "coming_soon", label: "Invoices", icon: Receipt },
  { kind: "active", label: "Settings", href: "/settings", icon: Settings },
];

type Props = { collapsed: boolean };

export function SidebarNav({ collapsed }: Props) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={150}>
      <nav className="flex flex-col gap-0.5 px-2 py-3">
        {SIDEBAR_NAV.map((entry) => {
          if (entry.kind === "active") {
            const active =
              pathname === entry.href || pathname.startsWith(`${entry.href}/`);
            const content = (
              <Link
                key={entry.label}
                href={entry.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0",
                )}
                aria-current={active ? "page" : undefined}
              >
                <entry.icon className="h-4 w-4 shrink-0" />
                {!collapsed ? <span className="truncate">{entry.label}</span> : null}
                {active && !collapsed ? (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />
                ) : null}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={entry.label}>
                <TooltipTrigger asChild>{content}</TooltipTrigger>
                <TooltipContent side="right">{entry.label}</TooltipContent>
              </Tooltip>
            ) : (
              content
            );
          }

          const stub = (
            <button
              key={entry.label}
              type="button"
              disabled
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-sidebar-foreground/40 cursor-not-allowed",
                collapsed && "justify-center px-0",
              )}
              aria-label={`${entry.label} — coming soon`}
            >
              <entry.icon className="h-4 w-4 shrink-0" />
              {!collapsed ? <span className="truncate">{entry.label}</span> : null}
              {!collapsed ? (
                <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>
              ) : null}
            </button>
          );

          return (
            <Tooltip key={entry.label}>
              <TooltipTrigger asChild>
                <span>{stub}</span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {entry.label} — coming soon
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
