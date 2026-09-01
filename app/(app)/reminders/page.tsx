import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Bell, Check, ExternalLink, X } from "lucide-react";

import { getCurrentUserAndOrg } from "@/lib/auth";
import {
  listRemindersForPage,
  type RemindersFilter,
} from "@/lib/queries/reminders";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import { ReminderRowActions } from "@/components/app/reminder-row-actions";

type SearchParams = { filter?: string };

const FILTERS: readonly RemindersFilter[] = [
  "active",
  "upcoming",
  "dismissed",
  "all",
];

const FILTER_LABELS: Record<RemindersFilter, string> = {
  active: "Active",
  upcoming: "Upcoming",
  dismissed: "Dismissed",
  all: "All",
};

function parseFilter(raw: string | undefined): RemindersFilter {
  return (FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as RemindersFilter)
    : "active";
}

export const metadata = { title: "Reminders" };

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await getCurrentUserAndOrg();
  const filter = parseFilter(searchParams.filter);
  const rows = await listRemindersForPage(filter);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      <header className="space-y-1">
        <h1 className="font-geist text-[24px] font-semibold tracking-tight">
          Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything the app has flagged for you — license expiries,
          invoice due dates, and anything you added by hand.
        </p>
      </header>

      <nav
        aria-label="Reminder filters"
        className="flex items-center gap-1 border-b"
      >
        {FILTERS.map((value) => {
          const active = filter === value;
          return (
            <Link
              key={value}
              href={value === "active" ? "/reminders" : `/reminders?filter=${value}`}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium tracking-wider uppercase transition-colors",
                active
                  ? "border-info text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTER_LABELS[value]}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={
            filter === "active"
              ? "You're all caught up."
              : "Nothing here."
          }
          description={
            filter === "active"
              ? "Reminders will appear here once the app schedules one, or you create one by hand."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => {
            const isDismissed = r.dismissed_at !== null;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5",
                  isDismissed && "opacity-60",
                )}
              >
                <div className="flex-1 space-y-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">{r.title}</p>
                  {r.body ? (
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {r.body}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {format(parseISO(r.remind_at), "MMM d, yyyy · h:mm a")}
                    {r.kind !== "custom" ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">
                        {r.kind.replace("_", " ")}
                      </span>
                    ) : null}
                  </p>
                </div>
                {r.link_url ? (
                  <Link
                    href={r.link_url}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Open source"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
                {!isDismissed ? (
                  <ReminderRowActions reminderId={r.id} />
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {r.completed_at ? (
                      <>
                        <Check className="h-3 w-3" /> Completed
                      </>
                    ) : (
                      <>
                        <X className="h-3 w-3" /> Dismissed
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
