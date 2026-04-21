"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { MemberRole } from "@prisma/client";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { deleteCustomer, updateCustomer } from "@/lib/actions/customers";
import { canManageCustomers } from "@/lib/rbac";
import { OrderStageBadge } from "./order-stage-badge";
import type {
  CustomerDetailRow,
  CustomerOrderRow,
} from "@/lib/queries/customers-full";

type Props = {
  customer: CustomerDetailRow | null;
  orders: CustomerOrderRow[];
  role: MemberRole;
  currency: string;
};

function formatMoney(value: string | null, currency: string): string {
  const n = value ? Number(value) : 0;
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

export function CustomerDetailSheet({ customer, orders, role, currency }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const open = Boolean(customer) && Boolean(searchParams.get("id"));
  const canEdit = canManageCustomers(role);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id");
    router.push(`/customers?${params.toString()}`);
  }

  function save(patchKey: string, nextValue: string | undefined) {
    if (!customer) return;
    startTransition(async () => {
      const patch: Record<string, string | undefined> = { [patchKey]: nextValue };
      const res = await updateCustomer({ id: customer.id, patch });
      if (!res.ok) {
        toast.error("Save failed", { description: res.error });
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  async function onDelete() {
    if (!customer) return;
    setDeleting(true);
    const res = await deleteCustomer({ id: customer.id });
    setDeleting(false);
    if (!res.ok) {
      toast.error("Couldn't delete customer", { description: res.error });
      return;
    }
    toast.success(`${customer.name} removed`);
    close();
    router.refresh();
  }

  if (!customer) {
    return (
      <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Customer not found</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <SheetContent className="flex w-full max-w-xl flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-2 border-b px-6 py-5">
          <SheetTitle className="text-lg">{customer.name}</SheetTitle>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {customer.company ? <span>{customer.company}</span> : null}
            {customer.phone ? (
              <a href={`tel:${customer.phone}`} className="underline underline-offset-4">
                {customer.phone}
              </a>
            ) : null}
            {customer.email ? (
              <a href={`mailto:${customer.email}`} className="underline underline-offset-4">
                {customer.email}
              </a>
            ) : null}
          </div>
          {canEdit ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="w-fit gap-1 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Their orders will be preserved but unlinked.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </SheetHeader>

        <Tabs defaultValue="orders" className="flex-1 overflow-hidden">
          <TabsList className="mx-6 mt-4">
            <TabsTrigger value="orders">Orders · {orders.length}</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="flex-1 overflow-y-auto px-6 py-5">
            {orders.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No orders yet for this customer.
              </p>
            ) : (
              <ul className="divide-y rounded-md border bg-card">
                {orders.map((order) => (
                  <li key={order.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Link
                      href={`/orders?order=${order.id}`}
                      className="flex flex-1 items-center gap-3"
                      onClick={close}
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {order.order_number}
                      </span>
                      <span className="flex-1 truncate">
                        {order.project_name ?? "Untitled"}
                      </span>
                      <OrderStageBadge stage={order.stage} />
                      <span
                        className={cn(
                          "w-20 text-right font-mono text-xs tabular-nums",
                          Number(order.balance_due) > 0 ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {formatMoney(order.balance_due, currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="info" className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <Field label="Company" value={customer.company ?? ""} disabled={!canEdit} onSave={(v) => save("company", v)} />
            <Field label="Email" value={customer.email ?? ""} disabled={!canEdit} onSave={(v) => save("email", v)} type="email" />
            <Field label="Phone" value={customer.phone ?? ""} disabled={!canEdit} onSave={(v) => save("phone", v)} />
            <Field label="Address" value={customer.address_line1 ?? ""} disabled={!canEdit} onSave={(v) => save("addressLine1", v)} />
            <Field label="Address (line 2)" value={customer.address_line2 ?? ""} disabled={!canEdit} onSave={(v) => save("addressLine2", v)} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="City" value={customer.city ?? ""} disabled={!canEdit} onSave={(v) => save("city", v)} />
              <Field label="State" value={customer.state ?? ""} disabled={!canEdit} onSave={(v) => save("state", v)} />
              <Field label="ZIP" value={customer.postal_code ?? ""} disabled={!canEdit} onSave={(v) => save("postalCode", v)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Notes</Label>
              <NotesEditor
                value={customer.notes ?? ""}
                disabled={!canEdit}
                onSave={(v) => save("notes", v)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Added {formatDate(customer.created_at)}
              {pending ? (
                <>
                  {" · "}
                  <Loader2 className="inline h-3 w-3 animate-spin" /> saving…
                </>
              ) : null}
            </p>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  disabled,
  onSave,
  type = "text",
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onSave: (value: string | undefined) => void;
  type?: "text" | "email";
}) {
  const [local, setLocal] = useState(value);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        value={local}
        type={type}
        disabled={disabled}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={() => {
          if (local === value) return;
          onSave(local === "" ? undefined : local);
        }}
        className="h-8 text-sm"
      />
    </div>
  );
}

function NotesEditor({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (value: string | undefined) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <Textarea
      value={local}
      rows={3}
      disabled={disabled}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => {
        if (local === value) return;
        onSave(local === "" ? undefined : local);
      }}
    />
  );
}
