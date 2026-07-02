"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  confirmExtraction,
  declineExtraction,
  reExtractFile,
} from "@/lib/actions/extractions";
import {
  FIELD_DEFS,
  fromInputValue,
  toInputValue,
  type FieldDef,
} from "@/lib/extraction/field-defs";
import { isSupportedType } from "@/lib/extraction/types";
import type { FileExtractionDetail } from "@/lib/queries/extractions";
import type { ProposedAction } from "@/lib/extraction/proposed-actions";

type Props = {
  extraction: FileExtractionDetail;
  proposedActions: ProposedAction[];
  signedSourceUrl: string | null;
};

const CONFIDENCE_LABEL = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;

// Rendered from the /orders page when ?extraction={fileId} is set.
// Closes by clearing that query param.
export function ExtractionReviewSheet({
  extraction,
  proposedActions,
  signedSourceUrl,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("extraction") === extraction.file.id;

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("extraction");
    router.replace(`/orders?${params.toString()}`);
  }

  const docType = extraction.document_type;
  const supported = isSupportedType(docType);
  const defs: FieldDef[] = useMemo(
    () => (supported ? FIELD_DEFS[docType] : []),
    [supported, docType],
  );

  const initialValues: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of defs) {
      out[def.key] = toInputValue(
        (extraction.extracted_fields ?? {})[def.key],
        def.kind,
      );
    }
    return out;
  }, [defs, extraction.extracted_fields]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const action of proposedActions) out[action.key] = action.defaultChecked;
    return out;
  });
  const [pending, startTransition] = useTransition();

  // Reset local state when the underlying extraction changes (e.g.
  // reopened for a different file).
  useEffect(() => {
    setValues(initialValues);
    const next: Record<string, boolean> = {};
    for (const action of proposedActions) next[action.key] = action.defaultChecked;
    setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction.id]);

  function editedFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of defs) {
      out[def.key] = fromInputValue(values[def.key] ?? "", def.kind);
    }
    return out;
  }

  function onConfirm() {
    startTransition(async () => {
      const res = await confirmExtraction({
        id: extraction.id,
        editedFields: editedFields(),
      });
      if (!res.ok) {
        toast.error("Couldn't confirm extraction", { description: res.error });
        return;
      }
      toast.success("Extraction confirmed");
      close();
      router.refresh();
    });
  }

  function onDecline() {
    startTransition(async () => {
      const res = await declineExtraction({ id: extraction.id });
      if (!res.ok) {
        toast.error("Couldn't decline", { description: res.error });
        return;
      }
      toast.success("Extraction declined");
      close();
      router.refresh();
    });
  }

  function onReExtract() {
    startTransition(async () => {
      const res = await reExtractFile({ fileId: extraction.file.id });
      if (!res.ok) {
        toast.error("Couldn't re-extract", { description: res.error });
        return;
      }
      toast.success("Re-extraction started");
      close();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(v) => (!v ? close() : undefined)}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted/40 text-brand">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Review extraction
          </SheetTitle>
          <SheetDescription>
            {extraction.file.original_name ?? "Uploaded document"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 grid gap-6 md:grid-cols-[6fr_5fr]">
          {/* LEFT — source preview */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md border bg-brand-muted/30 px-2 py-0.5 text-[11px] font-medium text-brand uppercase tracking-wider">
                {extraction.document_type}
              </span>
              {extraction.confidence ? (
                <span className="text-[11px] text-muted-foreground">
                  {CONFIDENCE_LABEL[extraction.confidence]}
                </span>
              ) : null}
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <SourcePreview
                signedSourceUrl={signedSourceUrl}
                mime={extraction.file.mime}
              />
            </div>
          </div>

          {/* RIGHT — editable fields + proposed actions */}
          <div className="space-y-6">
            {supported ? (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Extracted fields
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fix anything the model got wrong before confirming.
                  </p>
                </div>
                <div className="space-y-3">
                  {defs.map((def) => (
                    <FieldEditor
                      key={def.key}
                      def={def}
                      value={values[def.key] ?? ""}
                      onChange={(v) =>
                        setValues((prev) => ({ ...prev, [def.key]: v }))
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Classified as <strong>{extraction.document_type}</strong>. No
                fields were extracted. You can decline to skip this extraction
                or re-extract if this classification looks wrong.
              </div>
            )}

            {proposedActions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Proposed actions
                </p>
                <ul className="space-y-1.5">
                  {proposedActions.map((action) => {
                    const checked = selected[action.key] ?? false;
                    return (
                      <li key={action.key}>
                        <label
                          className={cn(
                            "flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-xs transition-colors",
                            checked
                              ? "border-brand/40 bg-brand-muted/20"
                              : "hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 accent-current text-brand"
                            checked={checked}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [action.key]: e.target.checked,
                              }))
                            }
                          />
                          <span>{action.description}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Selected actions run after you confirm. Sub-step 7 wires the
                  actual apply; the checkboxes are captured now.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={onDecline}
                disabled={pending}
              >
                Decline
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onReExtract}
                disabled={pending}
              >
                Re-extract
              </Button>
              <Button type="button" onClick={onConfirm} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm and apply
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SourcePreview({
  signedSourceUrl,
  mime,
}: {
  signedSourceUrl: string | null;
  mime: string | null;
}) {
  if (!signedSourceUrl) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center text-xs text-muted-foreground">
        Preview unavailable
      </div>
    );
  }
  const isImage = mime?.startsWith("image/");
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={signedSourceUrl}
        alt="Source document preview"
        className="h-auto w-full"
      />
    );
  }
  // Assume PDF (or something the browser knows how to render inline).
  return (
    <embed
      src={signedSourceUrl}
      type={mime ?? "application/pdf"}
      className="aspect-[4/3] w-full"
    />
  );
}

function FieldEditor({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${def.key}`;
  if (def.kind === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-[12px] font-medium">
          {def.label}
        </Label>
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="text-sm"
        />
      </div>
    );
  }
  const type =
    def.kind === "date"
      ? "date"
      : def.kind === "money" || def.kind === "number"
      ? "number"
      : def.kind === "integer"
      ? "number"
      : "text";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12px] font-medium">
        {def.label}
      </Label>
      <div className="relative">
        {def.kind === "money" ? (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            $
          </span>
        ) : null}
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-9 text-sm", def.kind === "money" && "pl-6")}
          step={def.kind === "money" ? "0.01" : def.kind === "integer" ? "1" : undefined}
        />
      </div>
    </div>
  );
}
