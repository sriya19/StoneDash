import Link from "next/link";

import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { NewMenu } from "./new-menu";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Subtle wordmark on the left edge of the topbar. Keeps the
          StoneDash brand visible inside the app without competing with
          the per-tenant org name that lives in the sidebar. */}
      <Link
        href="/dashboard"
        className="hidden items-center gap-1.5 text-sm tracking-tight md:flex"
        aria-label="StoneDash home"
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full bg-brand"
        />
        <span className="font-geist font-semibold">StoneDash</span>
      </Link>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <span aria-hidden="true" className="hidden text-muted-foreground/50 md:inline">
          /
        </span>
        <Breadcrumbs />
      </div>
      <CommandPalette />
      <NewMenu />
    </header>
  );
}
