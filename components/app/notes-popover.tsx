"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateOrder } from "@/lib/actions/orders";

type Props = {
  orderId: string;
  value: string;
  trigger: React.ReactNode;
  disabled?: boolean;
};

const MAX = 4000;

// Small inline notes editor. Used on the orders table (icon trigger) and
// anywhere else we want a quick edit without opening the full detail sheet.
// Saves on blur or Cmd/Ctrl+Enter via updateOrder — optimistic + toast.
export function NotesPopover({ orderId, value, trigger, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setLocal(value);
  }, [open, value]);

  function commit(next: string) {
    const normalized = next.length === 0 ? undefined : next;
    const original = value.length === 0 ? undefined : value;
    if (normalized === original) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await updateOrder({
        id: orderId,
        patch: { notes: normalized },
      });
      if (!res.ok) {
        toast.error("Couldn't save note", { description: res.error });
        return;
      }
      toast.success("Note saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={(next) => (disabled ? null : setOpen(next))}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] space-y-2 p-3">
        <Textarea
          value={local}
          rows={6}
          maxLength={MAX}
          onChange={(event) => setLocal(event.target.value)}
          onBlur={() => commit(local)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              commit(local);
            }
          }}
          placeholder="Add a note…"
          autoFocus
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {pending ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> saving…
              </span>
            ) : (
              <span className="text-muted-foreground/70">⌘↵ to save</span>
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => commit(local)}
            disabled={pending}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
