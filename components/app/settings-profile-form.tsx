"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "next-themes";
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
import { updateProfile } from "@/lib/actions/settings";
import { UpdateProfileInput, type UpdateProfileInputT } from "@/lib/validators/settings";

type Props = {
  initial: UpdateProfileInputT;
  email: string;
};

export function SettingsProfileForm({ initial, email }: Props) {
  const { setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const form = useForm<UpdateProfileInputT>({
    resolver: zodResolver(UpdateProfileInput),
    defaultValues: initial,
  });

  function submit(values: UpdateProfileInputT) {
    startTransition(async () => {
      const res = await updateProfile(values);
      if (!res.ok) {
        toast.error("Couldn't save profile", { description: res.error });
        return;
      }
      setTheme(values.theme);
      toast.success("Profile saved");
    });
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="max-w-lg space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="p-name">Full name</Label>
        <Input id="p-name" {...form.register("fullName")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p-email">Email</Label>
        <Input id="p-email" value={email} disabled />
        <p className="text-xs text-muted-foreground">
          Email is tied to your Supabase auth account and can&apos;t be changed here yet.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p-phone">Phone</Label>
        <Input id="p-phone" {...form.register("phone")} placeholder="(555) 555-0100" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p-theme">Theme</Label>
        <Select
          value={form.watch("theme")}
          onValueChange={(value) =>
            form.setValue("theme", value as UpdateProfileInputT["theme"], { shouldValidate: true })
          }
        >
          <SelectTrigger id="p-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending} className="gap-1">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </form>
  );
}
