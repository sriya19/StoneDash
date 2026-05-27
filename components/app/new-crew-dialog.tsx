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
import { createCrewMember } from "@/lib/actions/crew";
import {
  CrewMemberFields,
  CREW_ROLE_SUGGESTIONS,
  type CrewMemberFieldsT,
} from "@/lib/validators/crew";

export function NewCrewDialog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";
  const [pending, startTransition] = useTransition();

  const form = useForm<CrewMemberFieldsT>({
    resolver: zodResolver(CrewMemberFields),
    defaultValues: {
      name: "",
      role: "",
      phone: "",
      email: "",
      notes: "",
      isActive: true,
    },
  });

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const next = params.toString();
    router.push(`/team${next ? `?${next}` : ""}`);
    form.reset();
  }

  function submit(values: CrewMemberFieldsT) {
    startTransition(async () => {
      const res = await createCrewMember(values);
      if (!res.ok) {
        toast.error("Couldn't add crew member", { description: res.error });
        return;
      }
      toast.success("Crew member added");
      form.reset();
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      params.set("id", res.data.id);
      router.push(`/team?${params.toString()}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New crew member</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cm-name">Name</Label>
            <Input
              id="cm-name"
              {...form.register("name")}
              placeholder="Carlos Mendez"
              autoFocus
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-role">Role</Label>
            <Input
              id="cm-role"
              list="cm-role-list"
              {...form.register("role")}
              placeholder="Lead Installer"
            />
            <datalist id="cm-role-list">
              {CREW_ROLE_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <p className="text-[11px] text-muted-foreground">
              Free text — suggestions: {CREW_ROLE_SUGGESTIONS.join(" · ")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm-phone">Phone</Label>
              <Input id="cm-phone" {...form.register("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-email">Email</Label>
              <Input id="cm-email" type="email" {...form.register("email")} />
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-notes">Notes</Label>
            <Textarea
              id="cm-notes"
              rows={3}
              {...form.register("notes")}
              placeholder="Owns the green truck, prefers Tuesdays off…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="gap-1">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add crew member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
