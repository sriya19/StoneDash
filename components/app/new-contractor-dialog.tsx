"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createContractor } from "@/lib/actions/contractors";
import {
  ContractorFields,
  PAYMENT_TERMS_SUGGESTIONS,
  type ContractorFieldsT,
} from "@/lib/validators/contractors";

export function NewContractorDialog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";
  const [pending, startTransition] = useTransition();

  const form = useForm<ContractorFieldsT>({
    resolver: zodResolver(ContractorFields),
    defaultValues: {
      name: "",
      primaryContact: "",
      phone: "",
      email: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      paymentTerms: "",
      notes: "",
      isActive: true,
    },
  });

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.push(`/contractors?${params.toString()}`);
    form.reset();
  }

  function submit(values: ContractorFieldsT) {
    startTransition(async () => {
      const res = await createContractor(values);
      if (!res.ok) {
        toast.error("Couldn't create contractor", { description: res.error });
        return;
      }
      toast.success("Contractor added");
      form.reset();
      router.push(`/contractors/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New contractor</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ct-name">Company name</Label>
            <Input
              id="ct-name"
              {...form.register("name")}
              placeholder="Ameer Construction"
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ct-contact">Primary contact</Label>
              <Input
                id="ct-contact"
                {...form.register("primaryContact")}
                placeholder="Ameer Hassan"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-phone">Phone</Label>
              <Input id="ct-phone" {...form.register("phone")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-email">Email</Label>
            <Input id="ct-email" type="email" {...form.register("email")} />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-addr">Address</Label>
            <Input id="ct-addr" {...form.register("addressLine1")} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ct-city">City</Label>
              <Input id="ct-city" {...form.register("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-state">State</Label>
              <Input id="ct-state" {...form.register("state")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-zip">ZIP</Label>
              <Input id="ct-zip" {...form.register("postalCode")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-terms">Payment terms</Label>
            <Input
              id="ct-terms"
              list="ct-terms-list"
              {...form.register("paymentTerms")}
              placeholder="Net 30"
            />
            <datalist id="ct-terms-list">
              {PAYMENT_TERMS_SUGGESTIONS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p className="text-[11px] text-muted-foreground">
              Free text — suggestions: {PAYMENT_TERMS_SUGGESTIONS.join(" · ")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-notes">Notes</Label>
            <Textarea id="ct-notes" rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="gap-1">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add contractor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
