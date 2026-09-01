"use client";

import { AlertCircle, CheckCircle2, MinusCircle, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AiIntakeStatus } from "@/lib/supabase/types";

type Props = {
  status: AiIntakeStatus;
  onReview?: () => void;
  className?: string;
};

// Mirrors <ExtractionChip> from Task 5: same five-state pattern.
// Only `review` is interactive. Task 8 moved processing / review /
// confirmed to `info` in both files at once — see the note there.
export function IntakeStatusChip({ status, onReview, className }: Props) {
  if (status === "processing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info",
          className,
        )}
        aria-label="AI intake processing"
      >
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-pulse rounded-full bg-info" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-info [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-info [animation-delay:300ms]" />
        </span>
        Reading…
      </span>
    );
  }

  if (status === "review") {
    return (
      <button
        type="button"
        onClick={onReview}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info transition-colors hover:bg-info/20",
          className,
        )}
        aria-label="Review AI intake"
      >
        <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
        Ready for review
      </button>
    );
  }

  if (status === "confirmed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info",
          className,
        )}
      >
        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
        Confirmed
      </span>
    );
  }

  if (status === "discarded") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
          className,
        )}
      >
        <MinusCircle className="h-2.5 w-2.5" aria-hidden="true" />
        Discarded
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      <AlertCircle className="h-2.5 w-2.5" aria-hidden="true" />
      AI couldn&apos;t read this
    </span>
  );
}
