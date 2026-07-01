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
export function ExtractionChip({ data, onReview, className }: Props) {
  if (data.status === "processing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-muted/30 px-2 py-0.5 text-[10px] font-medium text-brand",
          className,
        )}
        aria-label="AI extraction in progress"
      >
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-pulse rounded-full bg-brand" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-brand [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-brand [animation-delay:300mS]" />
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
          "inline-flex items-center gap-1.5 rounded-full border border-brand bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand transition-colors hover:bg-brand/20",
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
          "inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success",
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
