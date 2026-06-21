"use client";

import { useTheme } from "next-themes";
import { Laptop, LogOut, Moon, Sun } from "lucide-react";

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

// Theme is now a segmented row inside the user popover. Three buttons,
// active one carries the brand-muted tint. Same target surface as the
// old standalone dropdown, but with no separate icon competing for
// attention at the sidebar foot.
function ThemeSegmented() {
  const { theme, setTheme, systemTheme } = useTheme();
  const resolved = theme ?? "system";
  const options = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "system", icon: Laptop, label: "System" },
    { value: "dark", icon: Moon, label: "Dark" },
  ] as const;
  return (
    <div className="px-2 pb-2">
      <p className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Theme
      </p>
      <div className="flex rounded-md border bg-muted/40 p-0.5">
        {options.map((opt) => {
          const active = resolved === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              aria-pressed={active}
              aria-label={`${opt.label} theme${
                opt.value === "system" && systemTheme
                  ? ` (currently ${systemTheme})`
                  : ""
              }`}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                active
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <opt.icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
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
              <AvatarFallback className="bg-brand text-[11px] text-brand-foreground">
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
        <DropdownMenuContent
          align={collapsed ? "start" : "end"}
          side="top"
          className="w-64 p-0"
        >
          <DropdownMenuLabel className="flex items-center gap-2.5 px-3 py-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-brand text-xs text-brand-foreground">
                {initials(fullName, email)}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium">
                {fullName ?? "Account"}
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {email}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-0" />
          <ThemeSegmented />
          <DropdownMenuSeparator className="my-0" />
          <DropdownMenuItem asChild className="px-3 py-2">
            <form action="/logout" method="post" className="w-full">
              <button
                type="submit"
                className="flex w-full items-center gap-2 text-sm"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
