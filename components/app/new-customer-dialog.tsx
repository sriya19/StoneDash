"use client";

import { useState, useTransition } from "react";
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
import { createCustomer } from "@/lib/actions/customers";
import { CustomerFields, type CustomerFieldsT } from "@/lib/validators/customers";

export function NewCustomerDialog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";
  const [pending, startTransition] = useTransition();
  const [formError] = useState<string | null>(null);

  const form = useForm<CustomerFieldsT>({
    resolver: zodResolver(CustomerFields),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      notes: "",
    },
  });

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.push(`/customers?${params.toString()}`);
    form.reset();
  }

  function submit(values: CustomerFieldsT) {
    startTransition(async () => {
      const res = await createCustomer(values);
      if (!res.ok) {
        toast.error("Couldn't create customer", { description: res.error });
        return;
      }
      toast.success("Customer added");
      close();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" {...form.register("name")} placeholder="Sarah Chen" />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-company">Company</Label>
              <Input id="c-company" {...form.register("company")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" {...form.register("phone")} placeholder="(555) 201-3344" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" {...form.register("email")} />
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-addr">Address</Label>
            <Input id="c-addr" {...form.register("addressLine1")} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-city">City</Label>
              <Input id="c-city" {...form.register("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-state">State</Label>
              <Input id="c-state" {...form.register("state")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-zip">ZIP</Label>
              <Input id="c-zip" {...form.register("postalCode")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Notes</Label>
            <Textarea id="c-notes" rows={3} {...form.register("notes")} />
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="gap-1">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
