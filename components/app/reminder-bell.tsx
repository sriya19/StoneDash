"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { completeReminder, dismissReminder } from "@/lib/actions/reminders";
import type { ReminderRow } from "@/lib/supabase/types";

type Props = {
  initialCount: number;
  initialReminders: ReminderRow[];
};

// Q6 lock: 60s timer + focus + visibility listener. 60s beats 30s
// because reminders are minute-scale; the bandwidth savings compound
// across users. Tab-hidden cancels the timer so an open-but-hidden
// tab doesn't hammer the endpoint.
const POLL_MS = 60_000;

export function ReminderBell({ initialCount, initialReminders }: Props) {
  const [count, setCount] = useState(initialCount);
  const [reminders, setReminders] = useState<ReminderRow[]>(initialReminders);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders/active", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        count: number;
        reminders: ReminderRow[];
      };
      setCount(body.count);
      setReminders(body.reminders);
    } catch {
      // Network hiccup or the endpoint 500'd — skip this tick. The
      // next timer / focus event will retry.
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(refresh, POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refresh();
        start();
      }
    };
    const onFocus = () => {
      void refresh();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          aria-label={`Reminders${count > 0 ? ` (${count} active)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {count > 0 ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-medium text-brand-foreground tabular-nums",
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Reminders</p>
            <p className="text-[11px] text-muted-foreground">
              {count === 0
                ? "You're all caught up."
                : `${count} active reminder${count === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link
            href="/reminders"
            onClick={() => setOpen(false)}
            className="text-xs text-info underline-offset-4 hover:underline"
          >
            See all
          </Link>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {reminders.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            <ul className="divide-y">
              {reminders.map((r) => (
                <ReminderRowItem
                  key={r.id}
                  reminder={r}
                  onChanged={() => {
                    void refresh();
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReminderRowItem({
  reminder,
  onChanged,
}: {
  reminder: ReminderRow;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function onDismiss() {
    startTransition(async () => {
      const res = await dismissReminder({ id: reminder.id });
      if (!res.ok) {
        toast.error("Couldn't dismiss", { description: res.error });
        return;
      }
      onChanged();
    });
  }

  function onComplete() {
    startTransition(async () => {
      const res = await completeReminder({ id: reminder.id });
      if (!res.ok) {
        toast.error("Couldn't complete", { description: res.error });
        return;
      }
      onChanged();
    });
  }

  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1 min-w-0">
          <p className="text-sm leading-snug">{reminder.title}</p>
          {reminder.body ? (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {reminder.body}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {formatDistanceToNow(parseISO(reminder.remind_at), {
              addSuffix: true,
            })}
          </p>
        </div>
        {reminder.link_url ? (
          <Link
            href={reminder.link_url}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open source"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={onDismiss}
          disabled={pending}
        >
          <X className="h-3 w-3" /> Dismiss
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={onComplete}
          disabled={pending}
        >
          <Check className="h-3 w-3" /> Complete
        </Button>
      </div>
    </li>
  );
}
