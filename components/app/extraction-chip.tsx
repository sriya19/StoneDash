"use client";

import { AlertCircle, CheckCircle2, MinusCircle, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ExtractionDocumentType,
  ExtractionStatus,
} from "@/lib/supabase/types";

export type ExtractionChipData = {
  status: ExtractionStatus;
  documentType: ExtractionDocumentType;
};

type Props = {
  data: ExtractionChipData;
  // Called on click when status is 'review'. Ignored otherwise.
  onReview?: () => void;
  className?: string;
};

const DOC_LABEL: Record<ExtractionDocumentType, string> = {
  template: "template",
  contract: "contract",
  invoice: "invoice",
  license: "license",
  insurance: "COI",
  other: "document",
};

// One chip covers all five statuses. Only the `review` variant is
// interactive; the rest are informational.
//
// Task 8 Q4(a): processing / review / confirmed all carry `info`. Both
// halves of the AI lifecycle are the machine reporting on itself, so
// green is freed to mean only "a user action succeeded". <IntakeStatusChip>
// is a deliberate mirror of this file and moved in lockstep — if you
// change a state here, change it there.
export function ExtractionChip({ data, onReview, className }: Props) {
  if (data.status === "processing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info",
          className,
        )}
        aria-label="AI extraction in progress"
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

  if (data.status === "review") {
    return (
      <button
        type="button"
        onClick={onReview}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info transition-colors hover:bg-info/20",
          className,
        )}
        aria-label={`Review AI ${DOC_LABEL[data.documentType]} extraction`}
      >
        <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
        Review {DOC_LABEL[data.documentType]}
      </button>
    );
  }

  if (data.status === "confirmed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info",
          className,
        )}
      >
        <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
        AI extracted
      </span>
    );
  }

  if (data.status === "declined") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
          className,
        )}
      >
        <MinusCircle className="h-2.5 w-2.5" aria-hidden="true" />
        Extraction skipped
      </span>
    );
  }

  // failed
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
