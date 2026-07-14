"use client";

import { useMemo, useState, useTransition } from "react";
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
import { confirmIntake, discardIntake } from "@/lib/actions/intake";
import { describeIntake } from "@/lib/intake/describe";
import type { IntakeExtraction } from "@/lib/intake/types";
import type { IntakeMatches } from "@/lib/intake/match";
import type {
  Proposal,
  ProposedIntakeAction,
} from "@/lib/intake/propose";

type Props = {
  intakeId: string;
  signedSourceUrl: string | null;
  extraction: IntakeExtraction | null;
  matches: IntakeMatches | null;
  proposal: Proposal | null;
  errorMessage: string | null;
};

// Two-column Sheet mirroring Task 5's <ExtractionReviewSheet> but
// wider (sm:max-w-5xl) for the screenshot preview + action stack.
export function IntakeReviewSheet({
  intakeId,
  signedSourceUrl,
  extraction,
  matches,
  proposal,
  errorMessage,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("intake") === intakeId;

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("intake");
    router.replace(
      params.size > 0 ? `/intake?${params.toString()}` : "/intake",
    );
  }

  // Local editable state for each proposed action's fields. The
  // apply RPC (sub-step 10) will re-parse this JSON against the
  // per-action whitelist so a rogue client can't smuggle rogue
  // fields past the schema check.
  const [edits, setEdits] = useState<Record<string, ActionEditState>>(() =>
    buildInitialEdits(proposal),
  );

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    buildInitialSelected(proposal),
  );

  const [pending, startTransition] = useTransition();

  const summary = useMemo(
    () => (extraction ? describeIntake(extraction) : "No extraction yet."),
    [extraction],
  );

  const primaryActions = proposal?.primary ?? [];

  function onConfirm() {
    const selectedKeys = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    startTransition(async () => {
      const res = await confirmIntake({
        intakeId,
        edits,
        selectedActionKeys: selectedKeys,
      });
      if (!res.ok) {
        toast.error("Couldn't confirm intake", { description: res.error });
        return;
      }
      const n = Array.isArray(res.data.applied) ? res.data.applied.length : 0;
      toast.success(
        n > 0
          ? `Applied ${n} action${n === 1 ? "" : "s"}`
          : "Intake confirmed",
      );
      close();
      router.refresh();
    });
  }

  function onDiscard() {
    startTransition(async () => {
      const res = await discardIntake({ intakeId });
      if (!res.ok) {
        toast.error("Couldn't discard", { description: res.error });
        return;
      }
      toast.success("Intake discarded");
      close();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(v) => (!v ? close() : undefined)}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-5xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted/40 text-brand">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Review intake
          </SheetTitle>
          <SheetDescription>
            Confirm what you want applied, edit anything that&apos;s off,
            or discard the whole thing.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 grid gap-6 md:grid-cols-[6fr_5fr]">
          {/* LEFT — screenshot */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border bg-card">
              {signedSourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signedSourceUrl}
                  alt="Intake screenshot"
                  className="h-auto w-full"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center text-xs text-muted-foreground">
                  Preview unavailable
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — understanding + matches + actions */}
          <div className="space-y-5">
            {errorMessage ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errorMessage}
              </div>
            ) : null}

            <section className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                What I understood
              </p>
              <p className="text-sm leading-snug">{summary}</p>
              {extraction?.raw_transcript ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Full transcript</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-sans text-[11px] leading-snug">
                    {extraction.raw_transcript}
                  </pre>
                </details>
              ) : null}
            </section>

            {matches ? <MatchesPanel matches={matches} /> : null}

            <section className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Proposed actions
              </p>
              {primaryActions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing to do.
                </p>
              ) : (
                <ul className="space-y-2">
                  {primaryActions.map((action) => (
                    <li key={action.key}>
                      <ActionCard
                        action={action}
                        selected={selected[action.key] ?? false}
                        onToggle={(v) =>
                          setSelected((prev) => ({ ...prev, [action.key]: v }))
                        }
                        edit={edits[action.key]}
                        onEdit={(next) =>
                          setEdits((prev) => ({
                            ...prev,
                            [action.key]: next,
                          }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={onDiscard}
                disabled={pending}
              >
                Discard
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

// ---------------------------------------------------------------------------
// Matches panel — renders each matched entity with confidence tier
// ---------------------------------------------------------------------------

function MatchesPanel({ matches }: { matches: IntakeMatches }) {
  const hasAny =
    matches.matched_customer.id ||
    matches.matched_order.id ||
    matches.matched_contractor.id;
  if (!hasAny) {
    return (
      <section className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Matched to
        </p>
        <p className="text-xs text-muted-foreground">
          Nothing matched. Any proposed order / customer will be created new.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Matched to
      </p>
      <ul className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        {matches.matched_customer.id ? (
          <li>
            Customer · {matches.matched_customer.id.slice(0, 8)}… ·{" "}
            <span className="text-muted-foreground">
              {matches.matched_customer.tier} confidence (
              {matches.matched_customer.method})
            </span>
          </li>
        ) : null}
        {matches.matched_order.id ? (
          <li>
            Order · {matches.matched_order.id.slice(0, 8)}… ·{" "}
            <span className="text-muted-foreground">
              {matches.matched_order.tier} confidence (
              {matches.matched_order.method})
            </span>
          </li>
        ) : null}
        {matches.matched_contractor.id ? (
          <li>
            Contractor · {matches.matched_contractor.id.slice(0, 8)}… ·{" "}
            <span className="text-muted-foreground">
              {matches.matched_contractor.tier} confidence (
              {matches.matched_contractor.method})
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Action card — one per proposed action, checkbox + inline editors
// ---------------------------------------------------------------------------

type ActionEditState = Record<string, unknown>;

function buildInitialEdits(
  proposal: Proposal | null,
): Record<string, ActionEditState> {
  if (!proposal) return {};
  const out: Record<string, ActionEditState> = {};
  for (const a of proposal.primary) {
    out[a.key] = extractEditFields(a);
  }
  return out;
}

function buildInitialSelected(
  proposal: Proposal | null,
): Record<string, boolean> {
  if (!proposal) return {};
  const out: Record<string, boolean> = {};
  for (const a of proposal.primary) {
    out[a.key] = a.defaultChecked;
  }
  return out;
}

// Pluck the editable fields off a proposed action so we can round-
// trip user edits through the confirm call.
function extractEditFields(action: ProposedIntakeAction): ActionEditState {
  switch (action.type) {
    case "create_customer":
      return {
        name: action.name,
        phone: action.phone ?? "",
        email: action.email ?? "",
        address: action.address ?? "",
      };
    case "create_order":
      return {
        projectName: action.projectName,
        stoneType: action.stoneType ?? "",
        notes: action.notes ?? "",
        stage: action.stage,
      };
    case "create_event":
      return {
        kind: action.kind,
        startsAtIso: action.startsAtIso,
        durationMin: action.durationMin,
        locationText: action.locationText ?? "",
        notes: action.notes ?? "",
      };
    case "append_note":
      return { body: action.body };
    case "no_op":
      return {};
  }
}

function ActionCard({
  action,
  selected,
  onToggle,
  edit,
  onEdit,
}: {
  action: ProposedIntakeAction;
  selected: boolean;
  onToggle: (next: boolean) => void;
  edit: ActionEditState | undefined;
  onEdit: (next: ActionEditState) => void;
}) {
  const isNoOp = action.type === "no_op";
  const edits = edit ?? {};

  function set(field: string, value: unknown) {
    onEdit({ ...edits, [field]: value });
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 text-xs transition-colors",
        selected && !isNoOp ? "border-brand/40 bg-brand-muted/20" : "",
      )}
    >
      <label className="flex items-start gap-2">
        {!isNoOp ? (
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5 accent-current text-brand"
            checked={selected}
            onChange={(e) => onToggle(e.target.checked)}
          />
        ) : null}
        <span className="flex-1 text-sm leading-snug">{action.description}</span>
      </label>

      {selected && action.type === "create_customer" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <FieldRow
            id={`${action.key}-name`}
            label="Name"
            value={String(edits.name ?? "")}
            onChange={(v) => set("name", v)}
          />
          <FieldRow
            id={`${action.key}-phone`}
            label="Phone"
            value={String(edits.phone ?? "")}
            onChange={(v) => set("phone", v)}
          />
          <FieldRow
            id={`${action.key}-email`}
            label="Email"
            value={String(edits.email ?? "")}
            onChange={(v) => set("email", v)}
          />
          <FieldRow
            id={`${action.key}-address`}
            label="Address"
            value={String(edits.address ?? "")}
            onChange={(v) => set("address", v)}
          />
        </div>
      ) : null}

      {selected && action.type === "create_order" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <FieldRow
            id={`${action.key}-project`}
            label="Project name"
            value={String(edits.projectName ?? "")}
            onChange={(v) => set("projectName", v)}
          />
          <FieldRow
            id={`${action.key}-stone`}
            label="Stone type"
            value={String(edits.stoneType ?? "")}
            onChange={(v) => set("stoneType", v)}
          />
          <div className="col-span-2 space-y-1">
            <Label htmlFor={`${action.key}-notes`} className="text-[11px]">
              Notes
            </Label>
            <Textarea
              id={`${action.key}-notes`}
              value={String(edits.notes ?? "")}
              onChange={(e) => set("notes", e.target.value)}
              className="h-16 text-xs"
              rows={2}
            />
          </div>
        </div>
      ) : null}

      {selected && action.type === "create_event" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Date + time</Label>
            <Input
              type="datetime-local"
              value={dateTimeInputValue(String(edits.startsAtIso ?? ""))}
              onChange={(e) =>
                set("startsAtIso", `${e.target.value}:00`)
              }
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Duration (min)</Label>
            <Input
              type="number"
              value={Number(edits.durationMin ?? 60)}
              onChange={(e) => set("durationMin", Number(e.target.value))}
              className="h-8 text-xs"
              min={15}
              max={1440}
              step={15}
            />
          </div>
          <FieldRow
            id={`${action.key}-location`}
            label="Location"
            value={String(edits.locationText ?? "")}
            onChange={(v) => set("locationText", v)}
            className="col-span-2"
          />
          <div className="col-span-2 space-y-1">
            <Label htmlFor={`${action.key}-event-notes`} className="text-[11px]">
              Notes
            </Label>
            <Textarea
              id={`${action.key}-event-notes`}
              value={String(edits.notes ?? "")}
              onChange={(e) => set("notes", e.target.value)}
              className="h-16 text-xs"
              rows={2}
            />
          </div>
        </div>
      ) : null}

      {selected && action.type === "append_note" ? (
        <div className="mt-3 space-y-1">
          <Label className="text-[11px]">Note</Label>
          <Textarea
            value={String(edits.body ?? "")}
            onChange={(e) => set("body", e.target.value)}
            className="h-16 text-xs"
            rows={2}
          />
        </div>
      ) : null}
    </div>
  );
}

function FieldRow({
  id,
  label,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}

// The startsAtIso we get from propose() is yyyy-MM-ddTHH:mm:ss.
// <input type="datetime-local"> expects yyyy-MM-ddTHH:mm — drop
// seconds. Empty string when input is malformed so the user can
// re-pick.
function dateTimeInputValue(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m ? m[1]! : "";
}

