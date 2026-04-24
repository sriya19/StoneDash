"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { deleteContractorPayment } from "@/lib/actions/contractors";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validators/contractors";
import type { ContractorPayment } from "@/lib/queries/contractors";

type Props = {
  contractorId: string;
  payments: ContractorPayment[];
  currency: string;
  canEdit: boolean;
};

function moneyFmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

export function ContractorPaymentsTab({
  contractorId,
  payments,
  currency,
  canEdit,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deleting, startDeleting] = useTransition();
  const [confirmTarget, setConfirmTarget] = useState<ContractorPayment | null>(null);

  function openEdit(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("payment", id);
    router.push(`/contractors/${contractorId}?${params.toString()}`);
  }

  function openNew() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("payment", "new");
    router.push(`/contractors/${contractorId}?${params.toString()}`);
  }

  function handleDelete(payment: ContractorPayment) {
    startDeleting(async () => {
      const res = await deleteContractorPayment({ paymentId: payment.id });
      if (!res.ok) {
        toast.error("Couldn't delete payment", { description: res.error });
        setConfirmTarget(null);
        return;
      }
      toast.success("Payment deleted");
      setConfirmTarget(null);
      router.refresh();
    });
  }

  if (payments.length === 0) {
    return (
      <div className="space-y-4">
        {canEdit ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={openNew} className="gap-1">
              <Plus className="h-4 w-4" />
              Record payment
            </Button>
          </div>
        ) : null}
        <div className="rounded-xl border bg-card p-12 text-center">
          <p className="text-sm font-medium">No payments yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canEdit
              ? "Record a payment when a check comes in — you can split it across multiple jobs."
              : "No payments have been recorded for this contractor."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={openNew} className="gap-1">
            <Plus className="h-4 w-4" />
            Record payment
          </Button>
        </div>
      ) : null}

      <ol className="space-y-3">
        {payments.map((p) => (
          <li key={p.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums">
                    {moneyFmt(p.amount, currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    received {format(parseISO(p.receivedOn), "MMM d, yyyy")}
                  </span>
                  {p.method ? (
                    <Badge variant="secondary" className="font-normal">
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                    </Badge>
                  ) : null}
                  {p.reference ? (
                    <span className="text-xs text-muted-foreground">
                      Ref {p.reference}
                    </span>
                  ) : null}
                </div>
                {p.allocations.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Applied to:{" "}
                    {p.allocations.map((a, i) => (
                      <span key={a.orderId}>
                        <Link
                          href={`/orders?order=${a.orderId}`}
                          className="font-mono hover:underline"
                        >
                          {a.orderNumber}
                        </Link>
                        <span> ({moneyFmt(a.amount, currency)})</span>
                        {i < p.allocations.length - 1 ? ", " : null}
                      </span>
                    ))}
                  </p>
                ) : null}
                {p.notes ? (
                  <p className="text-xs italic text-muted-foreground">
                    “{p.notes}”
                  </p>
                ) : null}
              </div>

              {canEdit ? (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(p.id)}
                    className="gap-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmTarget(p)}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(next) => (!next ? setConfirmTarget(null) : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              The following balances will increase when the payment is
              removed:
              <ul className="mt-2 space-y-0.5 text-xs">
                {(confirmTarget?.allocations ?? []).map((a) => (
                  <li key={a.orderId}>
                    <span className="font-mono">{a.orderNumber}</span>
                    <span className="text-muted-foreground">
                      {" — "}+{moneyFmt(a.amount, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmTarget ? handleDelete(confirmTarget) : null
              }
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Delete payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
