"use client";

import { useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OrgSwitcher, type OrgSummary } from "./org-switcher";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export const SIDEBAR_COLLAPSED_COOKIE = "sb_collapsed";

type Props = {
  initialCollapsed: boolean;
  activeOrgId: string;
  orgs: OrgSummary[];
  user: { fullName: string | null; email: string };
};

export function Sidebar({ initialCollapsed, activeOrgId, orgs, user }: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // Persist collapse preference in a cookie so SSR matches.
  useEffect(() => {
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 ease-out",
        collapsed ? "w-14" : "w-60",
      )}
      aria-label="Primary"
    >
      <div className="flex h-12 items-center gap-1 border-b border-sidebar-border px-2">
        <div className="flex-1 min-w-0">
          <OrgSwitcher activeOrgId={activeOrgId} orgs={orgs} collapsed={collapsed} />
        </div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="shrink-0"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand" : "Collapse"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
      </div>
      <UserMenu
        fullName={user.fullName}
        email={user.email}
        collapsed={collapsed}
      />
    </aside>
  );
}
