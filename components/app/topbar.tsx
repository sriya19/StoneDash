import Link from "next/link";
import { Sparkles } from "lucide-react";

import {
  countActiveDueReminders,
  listActiveDueReminders,
} from "@/lib/queries/reminders";
import { getCurrentUserAndOrg } from "@/lib/auth";
import { hasAtLeast } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { NewMenu } from "./new-menu";
import { ReminderBell } from "./reminder-bell";

export async function Topbar() {
  // Load the initial bell count + first page of reminders server-side
  // so the badge is populated on first paint. <ReminderBell> then
  // takes over with its 60s + focus poll.
  const [initialCount, initialReminders, auth] = await Promise.all([
    countActiveDueReminders(),
    listActiveDueReminders(),
    getCurrentUserAndOrg(),
  ]);
  const canIntake = hasAtLeast(auth.role, "manager");

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
      {canIntake ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-brand/30 text-brand hover:bg-brand/5 hover:text-brand"
        >
          <Link href="/intake" aria-label="AI Intake">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden md:inline">AI Intake</span>
          </Link>
        </Button>
      ) : null}
      <ReminderBell
        initialCount={initialCount}
        initialReminders={initialReminders}
      />
      <NewMenu />
    </header>
  );
}
