"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { updateAiSettings } from "@/lib/actions/ai-settings";

type Props = {
  initial: {
    autoExtract: boolean;
    emailOnReview: boolean;
  };
  stats: {
    monthlySpendCents: number;
    pendingReview: number;
  };
};

function fmtSpend(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function SettingsAiForm({ initial, stats }: Props) {
  const [autoExtract, setAutoExtract] = useState(initial.autoExtract);
  const [emailOnReview, setEmailOnReview] = useState(initial.emailOnReview);
  const [pending, startTransition] = useTransition();

  function onToggleAutoExtract(next: boolean) {
    setAutoExtract(next);
    startTransition(async () => {
      const res = await updateAiSettings({ ai_auto_extract: next });
      if (!res.ok) {
        toast.error("Couldn't save", { description: res.error });
        setAutoExtract(!next);
      }
    });
  }
  function onToggleEmail(next: boolean) {
    setEmailOnReview(next);
    startTransition(async () => {
      const res = await updateAiSettings({ ai_email_on_review: next });
      if (!res.ok) {
        toast.error("Couldn't save", { description: res.error });
        setEmailOnReview(!next);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">AI document extraction</h2>
          <p className="text-xs text-muted-foreground">
            When on, uploaded documents run through GPT-4o vision to extract
            structured fields. You always confirm before anything is applied.
          </p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/20 px-3 py-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">
              Automatically extract data from uploaded documents
            </Label>
            <p className="text-xs text-muted-foreground">
              Turn off to upload files as before with no AI processing.
            </p>
          </div>
          <Checkbox
            checked={autoExtract}
            onCheckedChange={(v) => onToggleAutoExtract(v === true)}
            disabled={pending}
            aria-label="Auto-extract"
            className="mt-1"
          />
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/20 px-3 py-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">
              Email me when an extraction needs review
            </Label>
            <p className="text-xs text-muted-foreground">
              Email delivery lands in a follow-up task. Turning this on records
              your preference; no email is sent yet.
            </p>
          </div>
          <Checkbox
            checked={emailOnReview}
            onCheckedChange={(v) => onToggleEmail(v === true)}
            disabled={pending}
            aria-label="Email on review"
            className="mt-1"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">This month</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-0.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Spend on AI extractions
            </p>
            <p className="font-geist text-[24px] font-semibold tabular-nums">
              {fmtSpend(stats.monthlySpendCents)}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Pending reviews
            </p>
            <p className="font-geist text-[24px] font-semibold tabular-nums">
              {stats.pendingReview.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
