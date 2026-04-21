"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateOrganization } from "@/lib/actions/settings";
import {
  UpdateOrganizationInput,
  type UpdateOrganizationInputT,
} from "@/lib/validators/settings";

type Props = {
  initial: UpdateOrganizationInputT & { slug: string };
};

export function SettingsShopForm({ initial }: Props) {
  const [pending, startTransition] = useTransition();
  const form = useForm<UpdateOrganizationInputT>({
    resolver: zodResolver(UpdateOrganizationInput),
    defaultValues: {
      name: initial.name,
      timezone: initial.timezone,
      currency: initial.currency,
      orderPrefix: initial.orderPrefix,
      orderSeqStart: initial.orderSeqStart,
    },
  });

  function submit(values: UpdateOrganizationInputT) {
    startTransition(async () => {
      const res = await updateOrganization(values);
      if (!res.ok) {
        toast.error("Couldn't save shop settings", { description: res.error });
        return;
      }
      toast.success("Shop settings saved");
    });
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="max-w-xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="s-name">Shop name</Label>
        <Input id="s-name" {...form.register("name")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-slug">Slug</Label>
        <Input id="s-slug" value={initial.slug} disabled />
        <p className="text-xs text-muted-foreground">
          Slug can&apos;t be changed yet; contact support if you need to migrate.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-tz">Timezone</Label>
          <Input id="s-tz" {...form.register("timezone")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-currency">Currency</Label>
          <Select
            value={form.watch("currency")}
            onValueChange={(value) => form.setValue("currency", value)}
          >
            <SelectTrigger id="s-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD · US Dollar</SelectItem>
              <SelectItem value="CAD">CAD · Canadian Dollar</SelectItem>
              <SelectItem value="MXN">MXN · Mexican Peso</SelectItem>
              <SelectItem value="EUR">EUR · Euro</SelectItem>
              <SelectItem value="GBP">GBP · Pound Sterling</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-prefix">Order prefix</Label>
          <Input id="s-prefix" maxLength={6} {...form.register("orderPrefix")} />
          <p className="text-xs text-muted-foreground">
            Shown before the sequence, e.g. <span className="font-mono">TM-1042</span>.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-seq">Starting number</Label>
          <Input
            id="s-seq"
            type="number"
            min={1}
            {...form.register("orderSeqStart", { valueAsNumber: true })}
          />
          <p className="text-xs text-muted-foreground">
            Used when the next number would otherwise be lower than this.
          </p>
        </div>
      </div>
      <Button type="submit" disabled={pending} className="gap-1">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </form>
  );
}
