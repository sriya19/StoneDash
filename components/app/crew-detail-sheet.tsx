"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { deleteCrewMember, updateCrewMember } from "@/lib/actions/crew";
import { CREW_ROLE_SUGGESTIONS } from "@/lib/validators/crew";
import type { CrewDetail } from "@/lib/queries/crew";

type Props = {
  crew: CrewDetail | null;
};

const EVENT_KIND_LABEL: Record<string, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Other",
};

const EVENT_KIND_COLOR: Record<string, string> = {
  measurement: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
  install: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  delivery: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  pickup: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  other: "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function CrewDetailSheet({ crew }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const open = Boolean(crew) && Boolean(searchParams.get("id"));

  // Local form state seeded from the row. Save on blur per field.
  const [name, setName] = useState(crew?.name ?? "");
  const [role, setRole] = useState(crew?.role ?? "");
  const [phone, setPhone] = useState(crew?.phone ?? "");
  const [email, setEmail] = useState(crew?.email ?? "");
  const [notes, setNotes] = useState(crew?.notes ?? "");

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id");
    const next = params.toString();
    router.push(`/team${next ? `?${next}` : ""}`);
  }

  function save(patch: Record<string, unknown>) {
    if (!crew) return;
    startTransition(async () => {
      const res = await updateCrewMember({ id: crew.id, patch });
      if (!res.ok) {
        toast.error("Couldn't save", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  function toggleActive() {
    if (!crew) return;
    startTransition(async () => {
      const next = !crew.isActive;
      const res = await updateCrewMember({ id: crew.id, patch: { isActive: next } });
      if (!res.ok) {
        toast.error("Couldn't update", { description: res.error });
        return;
      }
      toast.success(next ? "Reactivated" : "Deactivated");
      router.refresh();
    });
  }

  function destroy() {
    if (!crew) return;
    setDeleting(true);
    startTransition(async () => {
      const res = await deleteCrewMember({ id: crew.id });
      setDeleting(false);
      if (!res.ok) {
        toast.error("Couldn't delete", { description: res.error });
        return;
      }
      toast.success("Crew member removed");
      close();
      router.refresh();
    });
  }

  const canDelete = crew !== null && crew.totalAssignmentCount === 0;

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        {crew ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {crew.name}
                {!crew.isActive ? (
                  <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                ) : null}
              </SheetTitle>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-1 pb-6">
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-d-name">Name</Label>
                  <Input
                    id="cm-d-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      if (name.trim() && name !== crew.name) save({ name: name.trim() });
                    }}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-d-role">Role</Label>
                  <Input
                    id="cm-d-role"
                    list="cm-role-list-detail"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    onBlur={() => {
                      if (role !== (crew.role ?? "")) save({ role });
                    }}
                    disabled={pending}
                    placeholder="Lead Installer"
                  />
                  <datalist id="cm-role-list-detail">
                    {CREW_ROLE_SUGGESTIONS.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-d-phone">Phone</Label>
                    <Input
                      id="cm-d-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onBlur={() => {
                        if (phone !== (crew.phone ?? "")) save({ phone });
                      }}
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-d-email">Email</Label>
                    <Input
                      id="cm-d-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => {
                        if (email !== (crew.email ?? "")) save({ email });
                      }}
                      disabled={pending}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-d-notes">Notes</Label>
                  <Textarea
                    id="cm-d-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => {
                      if (notes !== (crew.notes ?? "")) save({ notes });
                    }}
                    disabled={pending}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">Assignment history</h3>
                  <p className="text-xs text-muted-foreground">
                    {crew.totalAssignmentCount} total · {crew.activeAssignmentCount} active
                  </p>
                </div>
                {crew.history.length === 0 ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-4 text-xs text-muted-foreground">
                    No assignments yet. Schedule an event and add them via the crew picker.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border bg-card">
                    {crew.history.map((h) => (
                      <li key={h.eventId} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              EVENT_KIND_COLOR[h.kind] ?? EVENT_KIND_COLOR.other,
                            )}
                          >
                            {EVENT_KIND_LABEL[h.kind] ?? h.kind}
                          </span>
                          <span className="text-muted-foreground">
                            {format(parseISO(h.startsAt), "EEE, MMM d, h:mm a")}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <Link
                            href={`/orders?order=${h.orderId}`}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {h.orderNumber} — {h.projectName ?? "Untitled"}
                          </Link>
                          <span className="text-muted-foreground">
                            {STATUS_LABEL[h.status] ?? h.status}
                          </span>
                        </div>
                        {h.customerName ? (
                          <p className="mt-0.5 text-muted-foreground">{h.customerName}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {crew.totalAssignmentCount > crew.history.length ? (
                  <p className="text-[11px] text-muted-foreground">
                    Showing {crew.history.length} of {crew.totalAssignmentCount} assignments.
                  </p>
                ) : null}
              </section>

              <section className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <h3 className="text-sm font-medium">Danger zone</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleActive}
                    disabled={pending}
                  >
                    {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    {crew.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={!canDelete || deleting}
                        title={
                          canDelete
                            ? "Delete this crew member"
                            : "Disabled — has assignment history. Deactivate instead."
                        }
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {crew.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the crew member permanently. They have no
                          assignment history, so nothing else is affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={destroy}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {!canDelete ? (
                  <p className="text-[11px] text-muted-foreground">
                    Delete is disabled because this person has{" "}
                    {crew.totalAssignmentCount} assignment
                    {crew.totalAssignmentCount === 1 ? "" : "s"} on record.
                    Deactivate to hide them from the crew picker while keeping
                    history intact.
                  </p>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Crew member not found.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
