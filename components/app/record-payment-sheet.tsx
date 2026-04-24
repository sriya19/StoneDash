"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  recordContractorPayment,
  updateContractorPayment,
} from "@/lib/actions/contractors";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@/lib/validators/contractors";
import type {
  ContractorJob,
  ContractorPayment,
} from "@/lib/queries/contractors";

type Props = {
  contractorId: string;
  contractorName: string;
  currency: string;
  jobs: ContractorJob[];
  editPayment: ContractorPayment | null;
};

type RowState = {
  orderId: string;
  orderNumber: string;
  projectName: string | null;
  balance: number;
  amount: string;
};

function parseMoney(input: string): number {
  if (!input.trim()) return 0;
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

function moneyFmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function RecordPaymentSheet({
  contractorId,
  contractorName,
  currency,
  jobs,
  editPayment,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // The sheet is "open" whenever ?payment= is set. We only mount when open
  // from the parent, so `open` just drives the Radix transition.
  const open = searchParams.get("payment") !== null;

  // Seed the row list from the contractor's jobs. When editing, merge in
  // any prior allocation amounts so the user sees exactly what was saved.
  // Orders that were previously allocated to but whose contractor-balance
  // is now 0 still need a row (otherwise they silently disappear on edit).
  const editAllocationByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of editPayment?.allocations ?? []) {
      map.set(a.orderId, a.amount);
    }
    return map;
  }, [editPayment]);

  const initialRows: RowState[] = useMemo(() => {
    const byId = new Map<string, RowState>();
    for (const j of jobs) {
      // Effective balance for allocation: current contractor-side balance
      // plus whatever this payment previously allocated to this order
      // (that amount is "freed up" for re-allocation during edit).
      const prior = editAllocationByOrder.get(j.id) ?? 0;
      const effectiveBalance = j.contractorBalance + prior;
      if (j.stage === "cancelled") continue;
      byId.set(j.id, {
        orderId: j.id,
        orderNumber: j.orderNumber,
        projectName: j.projectName,
        balance: effectiveBalance,
        amount: prior > 0 ? prior.toFixed(2) : "",
      });
    }
    // Edit case: include orders that were previously allocated to even if
    // they don't appear in the current jobs list (shouldn't happen since
    // delete of an order cascades, but defensive).
    for (const a of editPayment?.allocations ?? []) {
      if (byId.has(a.orderId)) continue;
      byId.set(a.orderId, {
        orderId: a.orderId,
        orderNumber: a.orderNumber,
        projectName: a.projectName,
        balance: a.amount,
        amount: a.amount.toFixed(2),
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.orderNumber.localeCompare(b.orderNumber),
    );
  }, [jobs, editPayment, editAllocationByOrder]);

  // Local form state.
  const [amount, setAmount] = useState<string>(
    editPayment ? editPayment.amount.toFixed(2) : "",
  );
  const [receivedOn, setReceivedOn] = useState<string>(
    editPayment?.receivedOn ?? todayIso(),
  );
  const [method, setMethod] = useState<PaymentMethod | "">(
    (editPayment?.method as PaymentMethod | null) ?? "check",
  );
  const [reference, setReference] = useState<string>(editPayment?.reference ?? "");
  const [notes, setNotes] = useState<string>(editPayment?.notes ?? "");
  const [rows, setRows] = useState<RowState[]>(initialRows);

  const amountNum = parseMoney(amount);
  const applied = rows.reduce((acc, r) => acc + parseMoney(r.amount), 0);
  const remaining = amountNum - applied;
  const over = applied > amountNum;
  const canSubmit =
    amountNum > 0 &&
    Math.abs(remaining) < 0.005 &&
    rows.some((r) => parseMoney(r.amount) > 0);

  function updateRow(orderId: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) => (r.orderId === orderId ? { ...r, ...patch } : r)),
    );
  }

  function toggleRow(orderId: string, checked: boolean) {
    updateRow(orderId, checked ? { amount: "" } : { amount: "" });
    // Check = clears to 0 (user fills); uncheck = clears. Same effect but
    // semantically right — checkbox mirrors "this row participates".
  }

  function autoAllocate() {
    const target = amountNum;
    if (target <= 0) return;
    let remaining = target;
    const next: RowState[] = rows.map((r) => ({ ...r, amount: "" }));
    for (const r of next) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, r.balance);
      if (take <= 0) continue;
      r.amount = take.toFixed(2);
      remaining -= take;
    }
    setRows(next);
    if (remaining > 0.005) {
      toast.warning(
        `Applied ${moneyFmt(target - remaining, currency)} — ${moneyFmt(
          remaining,
          currency,
        )} still unallocated. Edit a row manually to finish.`,
      );
    }
  }

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("payment");
    const suffix = params.toString();
    router.push(
      `/contractors/${contractorId}${suffix ? `?${suffix}` : ""}`,
    );
  }

  function submit() {
    const allocations = rows
      .filter((r) => parseMoney(r.amount) > 0)
      .map((r) => ({ orderId: r.orderId, amount: parseMoney(r.amount) }));
    const payload = {
      contractorId,
      amount: amountNum,
      receivedOn,
      method: method || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      allocations,
    };

    startTransition(async () => {
      const res = editPayment
        ? await updateContractorPayment({
            ...payload,
            paymentId: editPayment.id,
          })
        : await recordContractorPayment(payload);

      if (!res.ok) {
        toast.error(
          editPayment ? "Couldn't save payment" : "Couldn't record payment",
          { description: res.error },
        );
        return;
      }
      toast.success(editPayment ? "Payment saved" : "Payment recorded");
      close();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            {editPayment ? "Edit payment" : "Record payment"} ·{" "}
            <span className="font-normal text-muted-foreground">
              {contractorName}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-amount">Amount received</Label>
              <Input
                id="p-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-date">Received on</Label>
              <Input
                id="p-date"
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-method">Method</Label>
              <Select
                value={method || undefined}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger id="p-method">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-ref">Reference</Label>
              <Input
                id="p-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Check # / Confirm #"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="p-notes">Notes</Label>
              <Textarea
                id="p-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything useful — what jobs this covers, memo text, etc."
              />
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Apply to jobs</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={autoAllocate}
                disabled={amountNum <= 0}
                className="gap-1"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Auto-allocate oldest first
              </Button>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
                This contractor has no open jobs to allocate to. Tag an order
                with this contractor first.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {rows.map((row) => {
                  const rowAmount = parseMoney(row.amount);
                  const checked = rowAmount > 0;
                  return (
                    <li
                      key={row.orderId}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          toggleRow(row.orderId, v === true)
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.orderNumber}
                          </span>
                          {row.projectName ? (
                            <span className="ml-2">{row.projectName}</span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Balance {moneyFmt(row.balance, currency)}
                        </p>
                      </div>
                      <Input
                        className="w-28 text-right tabular-nums"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) =>
                          updateRow(row.orderId, { amount: e.target.value })
                        }
                        placeholder="0.00"
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-end gap-4 text-xs tabular-nums">
              <div className="text-muted-foreground">
                Applied{" "}
                <span className="font-mono text-foreground">
                  {moneyFmt(applied, currency)}
                </span>
              </div>
              <div
                className={cn(
                  "font-mono",
                  over
                    ? "text-destructive"
                    : Math.abs(remaining) < 0.005
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                )}
              >
                {over
                  ? `Over by ${moneyFmt(applied - amountNum, currency)}`
                  : Math.abs(remaining) < 0.005
                    ? "Fully allocated"
                    : `Remaining ${moneyFmt(remaining, currency)}`}
              </div>
            </div>
          </section>
        </div>

        <SheetFooter className="border-t bg-background px-6 py-4">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit || pending}
            className="gap-1"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editPayment ? "Save payment" : "Record payment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
