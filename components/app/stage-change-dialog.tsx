"use client";

import { useEffect, useState } from "react";
import type { OrderStage } from "@prisma/client";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STAGE_LABELS } from "./pipeline-strip";

type Props = {
  open: boolean;
  orderNumber: string;
  fromStage: OrderStage;
  toStage: OrderStage;
  pending?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
};

const MIN = 3;
const MAX = 500;

export function StageChangeDialog({
  open,
  orderNumber,
  fromStage,
  toStage,
  pending,
  onConfirm,
  onCancel,
}: Props) {
  const [note, setNote] = useState("");

  // Reset when the dialog opens for a new transition.
  useEffect(() => {
    if (open) setNote("");
  }, [open, fromStage, toStage]);

  const trimmed = note.trim();
  const tooShort = trimmed.length < MIN;
  const tooLong = trimmed.length > MAX;
  const disabled = tooShort || tooLong || pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            Move <span className="font-mono text-sm">{orderNumber}</span>
          </DialogTitle>
          <DialogDescription>
            From <strong>{STAGE_LABELS[fromStage]}</strong> to{" "}
            <strong>{STAGE_LABELS[toStage]}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="stage-reason">Reason (what changed?)</Label>
          <Textarea
            id="stage-reason"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder="e.g. slab cracked during polish — back to remeasure"
            autoFocus
          />
          <div className="flex items-center justify-between text-xs">
            <span
              className={
                tooShort && trimmed.length > 0
                  ? "text-destructive"
                  : tooLong
                    ? "text-destructive"
                    : "text-muted-foreground"
              }
            >
              {tooShort
                ? `${MIN - trimmed.length} more character${MIN - trimmed.length === 1 ? "" : "s"}`
                : tooLong
                  ? `${trimmed.length - MAX} over limit`
                  : `${trimmed.length} / ${MAX}`}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={disabled}
            className="gap-1"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
