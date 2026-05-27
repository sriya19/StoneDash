"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, PlayCircle, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markEventStatusViaShareLink } from "@/lib/actions/share-links";
import type { EventStatus } from "@/lib/validators/events";

type Props = {
  slug: string;
  currentStatus: string;
};

// Determine which forward-progress buttons make sense given the current
// status. The state machine in update_event_status rejects illegal
// transitions (complete -> scheduled, cancelled -> in_progress); we hide
// the buttons that would be rejected so the user doesn't tap them.
function nextOptions(current: string): Array<{
  status: EventStatus;
  label: string;
  variant: "default" | "outline" | "secondary";
  icon: typeof Check;
}> {
  switch (current) {
    case "scheduled":
      return [
        { status: "en_route", label: "On my way", variant: "default", icon: MapPin },
        { status: "no_show", label: "No-show", variant: "outline", icon: X },
      ];
    case "en_route":
      return [
        { status: "in_progress", label: "Arrived", variant: "default", icon: PlayCircle },
        { status: "no_show", label: "No-show", variant: "outline", icon: X },
      ];
    case "in_progress":
      return [{ status: "complete", label: "Mark complete", variant: "default", icon: Check }];
    case "complete":
    case "cancelled":
    case "no_show":
      return []; // terminal — no forward buttons
    default:
      return [];
  }
}

export function SharePageActions({ slug, currentStatus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const options = nextOptions(currentStatus);
  if (options.length === 0) return null;

  function update(status: EventStatus) {
    startTransition(async () => {
      const res = await markEventStatusViaShareLink({ slug, status });
      if (!res.ok) {
        toast.error("Couldn't update", { description: res.error });
        return;
      }
      toast.success("Updated");
      router.refresh();
    });
  }

  return (
    <section className="space-y-2 border-t pt-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Update status
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <Button
            key={opt.status}
            type="button"
            variant={opt.variant}
            size="sm"
            disabled={pending}
            onClick={() => update(opt.status)}
            className="gap-1"
          >
            <opt.icon className="h-3.5 w-3.5" />
            {opt.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
