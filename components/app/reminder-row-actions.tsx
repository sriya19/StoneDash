"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { completeReminder, dismissReminder } from "@/lib/actions/reminders";

type Props = { reminderId: string };

// Sits inside the /reminders page's list rows. The page itself is a
// Server Component so we can't wire Dismiss / Complete inline — this
// tiny client island owns the two buttons + toast + refresh dance.
export function ReminderRowActions({ reminderId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onAction(kind: "dismiss" | "complete") {
    startTransition(async () => {
      const fn = kind === "dismiss" ? dismissReminder : completeReminder;
      const res = await fn({ id: reminderId });
      if (!res.ok) {
        toast.error(`Couldn't ${kind}`, { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={() => onAction("dismiss")}
        disabled={pending}
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        Dismiss
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={() => onAction("complete")}
        disabled={pending}
      >
        <Check className="h-3 w-3" /> Complete
      </Button>
    </div>
  );
}
