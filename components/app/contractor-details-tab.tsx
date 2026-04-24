"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  updateContractor,
  deleteContractor,
} from "@/lib/actions/contractors";
import {
  ContractorFields,
  PAYMENT_TERMS_SUGGESTIONS,
  type ContractorFieldsT,
} from "@/lib/validators/contractors";
import type { ContractorDetail } from "@/lib/queries/contractors";

type Props = {
  contractor: ContractorDetail;
  canEdit: boolean;
};

export function ContractorDetailsTab({ contractor, canEdit }: Props) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [deactivating, startDeactivating] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const form = useForm<ContractorFieldsT>({
    resolver: zodResolver(ContractorFields),
    defaultValues: {
      name: contractor.name,
      primaryContact: contractor.primaryContact ?? "",
      phone: contractor.phone ?? "",
      email: contractor.email ?? "",
      addressLine1: contractor.addressLine1 ?? "",
      addressLine2: contractor.addressLine2 ?? "",
      city: contractor.city ?? "",
      state: contractor.state ?? "",
      postalCode: contractor.postalCode ?? "",
      paymentTerms: contractor.paymentTerms ?? "",
      notes: contractor.notes ?? "",
      isActive: contractor.isActive,
    },
  });

  function submit(values: ContractorFieldsT) {
    startSaving(async () => {
      const res = await updateContractor({ id: contractor.id, patch: values });
      if (!res.ok) {
        toast.error("Couldn't save changes", { description: res.error });
        return;
      }
      toast.success("Contractor saved");
      router.refresh();
    });
  }

  function handleDeactivate() {
    startDeactivating(async () => {
      const res = await updateContractor({
        id: contractor.id,
        patch: { isActive: false },
      });
      if (!res.ok) {
        toast.error("Couldn't deactivate", { description: res.error });
        return;
      }
      toast.success("Contractor deactivated");
      router.refresh();
    });
  }

  function handleReactivate() {
    startDeactivating(async () => {
      const res = await updateContractor({
        id: contractor.id,
        patch: { isActive: true },
      });
      if (!res.ok) {
        toast.error("Couldn't reactivate", { description: res.error });
        return;
      }
      toast.success("Contractor reactivated");
      router.refresh();
    });
  }

  function handleDelete() {
    startDeleting(async () => {
      const res = await deleteContractor({ id: contractor.id });
      if (!res.ok) {
        toast.error("Couldn't delete", { description: res.error });
        setDeleteOpen(false);
        return;
      }
      toast.success("Contractor deleted");
      router.push("/contractors");
    });
  }

  const canDelete =
    contractor.balance.jobCount === 0 && contractor.paymentCount === 0;

  return (
    <div className="space-y-6">
      <form
        onSubmit={form.handleSubmit(submit)}
        className="rounded-xl border bg-card p-6"
      >
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Company name</Label>
            <Input id="d-name" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-contact">Primary contact</Label>
              <Input id="d-contact" {...form.register("primaryContact")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-phone">Phone</Label>
              <Input id="d-phone" {...form.register("phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-email">Email</Label>
            <Input id="d-email" type="email" {...form.register("email")} />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-addr1">Address line 1</Label>
              <Input id="d-addr1" {...form.register("addressLine1")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-addr2">Address line 2</Label>
              <Input id="d-addr2" {...form.register("addressLine2")} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-city">City</Label>
              <Input id="d-city" {...form.register("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-state">State</Label>
              <Input id="d-state" {...form.register("state")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-zip">ZIP</Label>
              <Input id="d-zip" {...form.register("postalCode")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-terms">Payment terms</Label>
            <Input
              id="d-terms"
              list="d-terms-list"
              {...form.register("paymentTerms")}
            />
            <datalist id="d-terms-list">
              {PAYMENT_TERMS_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-notes">Notes</Label>
            <Textarea id="d-notes" rows={4} {...form.register("notes")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={saving} className="gap-1">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </fieldset>
      </form>

      {canEdit ? (
        <div className="rounded-xl border border-destructive/30 bg-card p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <Separator className="my-4" />
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {contractor.isActive ? "Deactivate contractor" : "Reactivate contractor"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deactivating hides from default lists and the New Order picker.
                  Existing orders and payment history are preserved.
                </p>
              </div>
              <Button
                type="button"
                variant={contractor.isActive ? "outline" : "secondary"}
                size="sm"
                onClick={contractor.isActive ? handleDeactivate : handleReactivate}
                disabled={deactivating}
                className="gap-1 whitespace-nowrap"
              >
                {deactivating && <Loader2 className="h-4 w-4 animate-spin" />}
                {contractor.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Delete contractor</p>
                <p className="text-xs text-muted-foreground">
                  {canDelete
                    ? "Permanently removes the contractor. This cannot be undone."
                    : `Delete is disabled — ${contractor.balance.jobCount} ${pl("job", contractor.balance.jobCount)} and ${contractor.paymentCount} ${pl("payment", contractor.paymentCount)} still attached.`}
                </p>
              </div>
              <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={!canDelete || deleting}
                    className="gap-1 whitespace-nowrap"
                  >
                    {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this contractor?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes <strong>{contractor.name}</strong> permanently.
                      No orders or payments are attached so no linked data will be
                      affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      disabled={deleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      Delete permanently
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function pl(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
