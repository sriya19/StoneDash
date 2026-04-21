"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type Props = {
  fullName: string | null;
  email: string;
  collapsed: boolean;
};

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    const joined = parts.map((p) => p[0] ?? "").join("");
    return joined.toUpperCase() || email.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu({ fullName, email, collapsed }: Props) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-sidebar-border px-2 py-3",
        collapsed && "flex-col",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              "h-auto flex-1 justify-start gap-2 px-2 py-1.5",
              collapsed && "w-full justify-center px-0",
            )}
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[11px]">
                {initials(fullName, email)}
              </AvatarFallback>
            </Avatar>
            {!collapsed ? (
              <span className="flex flex-col items-start leading-tight">
                <span className="max-w-[140px] truncate text-sm">
                  {fullName ?? email}
                </span>
                <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">
                  {email}
                </span>
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col leading-tight">
            <span className="text-sm">{fullName ?? "Account"}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <form action="/logout" method="post" className="w-full">
              <button type="submit" className="flex w-full items-center gap-2">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeToggle />
    </div>
  );
}
